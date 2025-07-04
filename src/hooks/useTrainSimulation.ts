import { useState, useEffect, useRef, useCallback } from "react";
import * as turf from "@turf/turf";
import type { InfraSchema } from "@/utils/geoJsonUtils";

// TrainRoute class to represent a series of connected ways
export class TrainRoute {
  ways: string[];
  totalDistance: number;
  wayDistances: Map<string, number>; // Cumulative distance to start of each way
  infraData: InfraSchema;

  constructor(
    startWayId: string,
    infraData: InfraSchema,
    maxRouteLength: number = 50
  ) {
    this.ways = [];
    this.totalDistance = 0;
    this.wayDistances = new Map();
    this.infraData = infraData;

    this.buildRoute(startWayId, maxRouteLength);
  }

  // Build a route by following connected ways
  private buildRoute(startWayId: string, maxRouteLength: number): void {
    const visited = new Set<string>();
    let currentWayId = startWayId;
    let cumulativeDistance = 0;

    for (let i = 0; i < maxRouteLength; i++) {
      if (visited.has(currentWayId)) break;

      const way = this.infraData.ways[currentWayId];
      if (!way || way.nodes.length < 2) break;

      // Add current way to route
      this.ways.push(currentWayId);
      this.wayDistances.set(currentWayId, cumulativeDistance);
      visited.add(currentWayId);

      // Calculate distance of current way
      const coordinates = way.nodes
        .map((nodeId) => this.infraData.node_coords[nodeId])
        .filter((coord) => coord != null);
      if (coordinates.length < 2) break;

      const lineString = turf.lineString(coordinates);
      const wayDistance = turf.length(lineString);
      cumulativeDistance += wayDistance;

      // Find next connected way
      const endNodeId = way.nodes[way.nodes.length - 1];
      const connectedWays = Object.entries(this.infraData.ways).filter(
        ([otherWayId, otherWay]) => {
          if (otherWayId === currentWayId || visited.has(otherWayId))
            return false;
          return otherWay.nodes.includes(endNodeId);
        }
      );

      if (connectedWays.length === 0) break;

      // Pick the first connected way (could be randomized)
      currentWayId = connectedWays[0][0];
    }

    this.totalDistance = cumulativeDistance;
  }

  // Get position along the entire route given way and distance along that way
  getRoutePosition(wayId: string, distanceAlongWay: number): number {
    const wayStartDistance = this.wayDistances.get(wayId);
    if (wayStartDistance === undefined) return 0;

    return wayStartDistance + distanceAlongWay;
  }

  // Get way and distance along way given position along route
  getWayPosition(
    routePosition: number
  ): { wayId: string; distanceAlongWay: number } | null {
    let cumulativeDistance = 0;

    for (const wayId of this.ways) {
      const way = this.infraData.ways[wayId];
      if (!way || way.nodes.length < 2) continue;

      const coordinates = way.nodes
        .map((nodeId) => this.infraData.node_coords[nodeId])
        .filter((coord) => coord != null);
      if (coordinates.length < 2) continue;

      const lineString = turf.lineString(coordinates);
      const wayDistance = turf.length(lineString);

      if (
        routePosition >= cumulativeDistance &&
        routePosition <= cumulativeDistance + wayDistance
      ) {
        return {
          wayId,
          distanceAlongWay: routePosition - cumulativeDistance,
        };
      }

      cumulativeDistance += wayDistance;
    }

    return null;
  }

  // Check if a way is part of this route
  includesWay(wayId: string): boolean {
    return this.ways.includes(wayId);
  }
}

// Train class to represent individual trains
export class Train {
  id: string;
  // Position components
  wayId: string;
  fromNodeId: string;
  toNodeId: string;
  distanceAlongKm: number;
  // Velocity is m/s
  velocity: number;
  // Acceleration is m/s^2
  acceleration: number;
  // Current coordinates [longitude, latitude]
  coordinates: [number, number];
  // Current bearing in radians (direction of travel)
  bearing: number;

  // Route that this train follows
  route: TrainRoute;
  // Position along the entire route
  routePosition: number;
  // Base acceleration and deceleration rates
  baseAcceleration: number = 1; // m/s^2
  baseDeceleration: number = 2; // m/s^2
  emergencyDeceleration: number = 5; // m/s^2
  // Block signaling thresholds (in km)
  slowDownDistance: number = 1; // Start slowing down if train ahead is within 1km
  emergencyDistance: number = 0.3; // Emergency braking if train ahead is within 300m

  constructor(
    id: string,
    wayId: string,
    fromNodeId: string,
    toNodeId: string,
    distanceAlong: number = 0,
    infraData: InfraSchema
  ) {
    this.id = id;
    this.wayId = wayId;
    this.fromNodeId = fromNodeId;
    this.toNodeId = toNodeId;
    this.distanceAlongKm = distanceAlong;
    this.velocity = 0;
    this.acceleration = 0;
    this.coordinates = [0, 0];
    this.bearing = 0;
    this.route = new TrainRoute(wayId, infraData);
    this.routePosition = this.route.getRoutePosition(wayId, distanceAlong);

    // Initialize coordinates and bearing
    this.updateCoordinates(infraData);
  }

  // Update train position based on velocity and time
  update(
    deltaTime: number,
    infraData: InfraSchema,
    otherTrains: Train[]
  ): boolean {
    // Calculate distance to nearest train ahead
    const distanceToTrainAhead = this.getDistanceToTrainAhead(
      otherTrains,
      infraData
    );

    // Determine acceleration based on block signaling
    this.calculateAcceleration(distanceToTrainAhead);

    // Apply acceleration
    this.velocity += this.acceleration * deltaTime;

    // Apply some basic physics constraints
    const maxSpeed = 60 / 2.23694; // 60 mph in m/s
    this.velocity = Math.min(Math.max(this.velocity, 0), maxSpeed);

    // Move the train (always forward)
    const distanceToMove = (this.velocity * deltaTime) / 1000; // Convert to km
    this.distanceAlongKm += distanceToMove;
    this.routePosition += distanceToMove;

    // Update coordinates
    this.updateCoordinates(infraData);

    // Check if train has reached the end of the way
    return this.hasReachedEnd(infraData);
  }

  // Calculate distance to the nearest train ahead on the same route
  private getDistanceToTrainAhead(
    otherTrains: Train[],
    infraData: InfraSchema
  ): number {
    const currentWayIndex = this.route.ways.indexOf(this.wayId);
    if (currentWayIndex === -1) return Number.MAX_SAFE_INTEGER;

    let cumulativeDistance = 0;

    // Start from current segment and check each segment ahead
    for (let i = currentWayIndex; i < this.route.ways.length; i++) {
      const wayId = this.route.ways[i];
      const way = infraData.ways[wayId];

      if (!way || way.nodes.length < 2) continue;

      // Calculate segment length
      const coordinates = way.nodes
        .map((nodeId: string) => infraData.node_coords[nodeId])
        .filter((coord: any) => coord != null);

      if (coordinates.length < 2) continue;

      const lineString = turf.lineString(coordinates);
      const segmentLength = turf.length(lineString);

      // Find trains on this segment
      const trainsOnSegment = otherTrains.filter(
        (train) => train.id !== this.id && train.wayId === wayId
      );

      if (trainsOnSegment.length > 0) {
        // Find the closest train ahead on this segment
        let closestTrainDistance = Infinity;

        for (const train of trainsOnSegment) {
          let distanceToTrain: number;

          if (i === currentWayIndex) {
            // Same segment as us - check if train is ahead
            if (train.distanceAlongKm > this.distanceAlongKm) {
              distanceToTrain =
                cumulativeDistance +
                (train.distanceAlongKm - this.distanceAlongKm);
            } else {
              // Train is behind us on same segment, skip
              continue;
            }
          } else {
            // Different segment ahead - distance is cumulative + train's position on segment
            distanceToTrain = cumulativeDistance + train.distanceAlongKm;
          }

          closestTrainDistance = Math.min(
            closestTrainDistance,
            distanceToTrain
          );
        }

        // If we found a train ahead, return the distance
        if (closestTrainDistance !== Infinity) {
          return closestTrainDistance;
        }
      }

      // Add this segment's length to cumulative distance for next iteration
      if (i === currentWayIndex) {
        // For current segment, only add remaining distance
        cumulativeDistance += Math.max(0, segmentLength - this.distanceAlongKm);
      } else {
        // For future segments, add full length
        cumulativeDistance += segmentLength;
      }
    }

    // No train found ahead on our route
    return Number.MAX_SAFE_INTEGER;
  }

  // Calculate acceleration based on distance to train ahead
  private calculateAcceleration(distanceToTrainAhead: number): void {
    // Calculate braking distance based on current velocity
    const brakingDistance =
      (this.velocity * this.velocity) / (2 * this.baseDeceleration * 1000); // Convert to km
    const emergencyBrakingDistance =
      (this.velocity * this.velocity) / (2 * this.emergencyDeceleration * 1000); // Convert to km

    // Adjust thresholds based on current velocity
    const adjustedSlowDownDistance = Math.max(
      this.slowDownDistance,
      brakingDistance + 0.2
    ); // Add safety margin
    const adjustedEmergencyDistance = Math.max(
      this.emergencyDistance,
      emergencyBrakingDistance + 0.1
    ); // Add safety margin

    if (distanceToTrainAhead <= adjustedEmergencyDistance) {
      // Emergency braking
      this.acceleration = -this.emergencyDeceleration;
    } else if (distanceToTrainAhead <= adjustedSlowDownDistance) {
      // Gradual slowdown based on distance
      const slowDownFactor =
        (distanceToTrainAhead - adjustedEmergencyDistance) /
        (adjustedSlowDownDistance - adjustedEmergencyDistance);
      this.acceleration = -this.baseDeceleration * (1 - slowDownFactor * 0.5); // Smoother slowdown
    } else {
      // Normal acceleration if no train ahead or far enough
      if (this.velocity < 20) {
        // Target speed of about 45 mph
        this.acceleration = this.baseAcceleration;
      } else {
        this.acceleration = 0; // Coast at target speed
      }
    }
  }

  // Update the train's coordinates based on its position along the way
  updateCoordinates(infraData: InfraSchema): void {
    const way = infraData.ways[this.wayId];

    if (!way || way.nodes.length < 2) {
      return;
    }

    // Get all coordinates for this way
    const coordinates = way.nodes
      .map((nodeId) => infraData.node_coords[nodeId])
      .filter((coord) => coord != null);

    if (coordinates.length < 2) {
      return;
    }

    // Create a line string to calculate position along
    const lineString = turf.lineString(coordinates);
    const lineLength = turf.length(lineString);

    // Clamp distance to line length
    const clampedDistance = Math.max(
      0,
      Math.min(this.distanceAlongKm, lineLength)
    );

    // Calculate position along the line
    const point = turf.along(lineString, clampedDistance);
    this.coordinates = point.geometry.coordinates as [number, number];

    // Calculate bearing based on current position and direction
    const currentSegmentIndex = Math.floor(
      (clampedDistance / lineLength) * (coordinates.length - 1)
    );
    const nextSegmentIndex = Math.min(
      currentSegmentIndex + 1,
      coordinates.length - 1
    );

    if (currentSegmentIndex !== nextSegmentIndex) {
      const currentNode = coordinates[currentSegmentIndex];
      const nextNode = coordinates[nextSegmentIndex];

      // Use turf.bearing for more accurate geographic bearing calculation
      const fromPoint = turf.point(currentNode);
      const toPoint = turf.point(nextNode);

      // Calculate bearing in degrees and convert to radians
      let bearingDegrees = turf.bearing(fromPoint, toPoint);
      let bearingRadians = turf.degreesToRadians(bearingDegrees);

      // Always moving forward, so no need to adjust bearing
      this.bearing = bearingRadians;
    }
  }

  // Check if train has reached the end of the current way
  hasReachedEnd(infraData: InfraSchema): boolean {
    const way = infraData.ways[this.wayId];

    if (!way || way.nodes.length < 2) {
      return true;
    }

    const coordinates = way.nodes
      .map((nodeId) => infraData.node_coords[nodeId])
      .filter((coord) => coord != null);
    if (coordinates.length < 2) {
      return true;
    }

    const lineString = turf.lineString(coordinates);
    const lineLength = turf.length(lineString);

    // Check if we've reached the end of the current way
    return this.distanceAlongKm >= lineLength;
  }

  // Move to next way following the preset route
  moveToNextWay(infraData: InfraSchema): boolean {
    // Find the current way index in the route
    const currentWayIndex = this.route.ways.indexOf(this.wayId);

    if (currentWayIndex === -1) {
      // Current way is not in the route, which shouldn't happen
      return false;
    }

    // Check if there's a next way in the route
    const nextWayIndex = currentWayIndex + 1;
    if (nextWayIndex >= this.route.ways.length) {
      // Reached the end of the route, train should disappear
      return false;
    }

    // Get the next way from the route
    const nextWayId = this.route.ways[nextWayIndex];
    const nextWay = infraData.ways[nextWayId];

    if (!nextWay || nextWay.nodes.length < 2) {
      // Invalid next way
      return false;
    }

    // Update train position to the next way
    this.wayId = nextWayId;
    this.fromNodeId = nextWay.nodes[0];
    this.toNodeId = nextWay.nodes[nextWay.nodes.length - 1];
    this.distanceAlongKm = 0; // Start at beginning of new way

    // Update route position
    this.routePosition = this.route.getRoutePosition(
      nextWayId,
      this.distanceAlongKm
    );

    return true;
  }
}

// Train manager to handle multiple trains
export class TrainManager {
  trains: Map<string, Train>;
  nextTrainId: number;
  infraData: InfraSchema;

  constructor(infraData: InfraSchema) {
    this.trains = new Map();
    this.nextTrainId = 1;
    this.infraData = infraData;
  }

  // Add a new train at a random location
  addRandomTrain(): string | null {
    const wayIds = Object.keys(this.infraData.ways);
    if (wayIds.length === 0) return null;

    // Pick a random way
    const randomWayId = wayIds[Math.floor(Math.random() * wayIds.length)];
    const way = this.infraData.ways[randomWayId];

    if (!way || way.nodes.length < 2) return null;

    const trainId = `train-${this.nextTrainId++}`;
    const train = new Train(
      trainId,
      randomWayId,
      way.nodes[0],
      way.nodes[way.nodes.length - 1],
      0,
      this.infraData
    );

    // Set initial velocity and acceleration
    train.velocity = 10; // Start with 10 m/s
    train.acceleration = 1; // 1 m/s^2

    this.trains.set(trainId, train);
    return trainId;
  }

  // Update all trains
  updateTrains(deltaTime: number, simulationRate: number = 1): void {
    const trainsToRemove: string[] = [];
    const adjustedDeltaTime = deltaTime * simulationRate;
    const allTrains = Array.from(this.trains.values());

    this.trains.forEach((train, trainId) => {
      const reachedEnd = train.update(
        adjustedDeltaTime,
        this.infraData,
        allTrains
      );

      if (reachedEnd) {
        // Try to move to next way
        if (!train.moveToNextWay(this.infraData)) {
          // No connected ways, remove train
          trainsToRemove.push(trainId);
        }
      }
    });

    // Remove trains that should disappear
    trainsToRemove.forEach((trainId) => {
      this.trains.delete(trainId);
    });
  }

  // Get all trains as an array
  getAllTrains(): Train[] {
    return Array.from(this.trains.values());
  }

  // Remove a specific train
  removeTrain(trainId: string): void {
    this.trains.delete(trainId);
  }

  // Clear all trains
  clearAllTrains(): void {
    this.trains.clear();
  }
}

// Hook to manage train simulation
export function useTrainSimulation(infraData: InfraSchema | null) {
  const [trainManager, setTrainManager] = useState<TrainManager | null>(null);
  const [trains, setTrains] = useState<Train[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [simulationRate, setSimulationRate] = useState(1);
  const lastUpdateTime = useRef<number>(Date.now());
  const animationFrameId = useRef<number | undefined>(undefined);

  // Create train manager when infraData is available
  useEffect(() => {
    if (infraData) {
      setTrainManager(new TrainManager(infraData));
    } else {
      setTrainManager(null);
    }
  }, [infraData]);

  // Animation loop
  const animate = useCallback(() => {
    if (!infraData || !isRunning || !trainManager) return;

    const currentTime = Date.now();
    const deltaTime = (currentTime - lastUpdateTime.current) / 1000; // Convert to seconds
    lastUpdateTime.current = currentTime;

    // Update trains with simulation rate
    trainManager.updateTrains(deltaTime, simulationRate);

    // Update state
    setTrains(trainManager.getAllTrains());

    // Continue animation
    animationFrameId.current = requestAnimationFrame(animate);
  }, [infraData, isRunning, trainManager, simulationRate]);

  // Start/stop simulation
  useEffect(() => {
    if (isRunning) {
      lastUpdateTime.current = Date.now();
      animationFrameId.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    }

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isRunning, animate]);

  // Functions to control simulation
  const startSimulation = () => setIsRunning(true);
  const stopSimulation = () => setIsRunning(false);
  const addTrain = () => {
    if (trainManager) {
      trainManager.addRandomTrain();
      setTrains(trainManager.getAllTrains());
    }
  };
  const clearTrains = () => {
    if (trainManager) {
      trainManager.clearAllTrains();
      setTrains([]);
    }
  };

  return {
    trains,
    isRunning,
    simulationRate,
    setSimulationRate,
    startSimulation,
    stopSimulation,
    addTrain,
    clearTrains,
  };
}
