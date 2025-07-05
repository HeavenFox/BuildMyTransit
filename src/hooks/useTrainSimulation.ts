import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as turf from "@turf/turf";
import type { InfraSchema } from "@/utils/geoJsonUtils";

class WaySection {
  readonly wayId: string;
  readonly startNodeId: string;
  readonly endNodeId: string;

  private nodeIds: string[];
  private points: [number, number][];

  constructor(
    infra: Infra,
    wayId: string,
    startNodeId?: string,
    endNodeId?: string
  ) {
    this.wayId = wayId;
    const way = infra.getWay(wayId);

    if (!way) {
      throw new Error(`Way not found: ${wayId}`);
    }

    if (!startNodeId) {
      this.startNodeId = way.nodes[0];
    } else {
      this.startNodeId = startNodeId;
    }
    if (!endNodeId) {
      this.endNodeId = way.nodes[way.nodes.length - 1];
    } else {
      this.endNodeId = endNodeId;
    }

    const startIndex = way.nodes.indexOf(this.startNodeId);
    const endIndex = way.nodes.indexOf(this.endNodeId);

    if (startIndex === -1 || endIndex === -1) {
      throw new Error(
        `Start or end node not found in way ${wayId}: ${this.startNodeId}, ${this.endNodeId}`
      );
    }

    if (startIndex > endIndex && !way.bidi) {
      console.warn(
        `Start node ${this.startNodeId} should not be after end node ${this.endNodeId} in unidirectional way ${wayId}`
      );
    }

    // Collect all nodes in the section
    if (startIndex < endIndex) {
      this.nodeIds = way.nodes.slice(startIndex, endIndex + 1);
    } else {
      this.nodeIds = [];
      for (let i = startIndex; i >= endIndex; i--) {
        this.nodeIds.push(way.nodes[i]);
      }
    }
    this.points = this.nodeIds.map((nodeId) => {
      const coords = infra.getNodeCoords(nodeId);
      if (!coords) {
        throw new Error(`Node coordinates not found for node ${nodeId}`);
      }
      return coords;
    });
  }

  // Get the coordinates of this section
  getCoordinates(): [number, number][] {
    return this.points;
  }

  // Calculate the distance of this section
  getDistance(): number {
    if (this.points.length < 2) return 0;

    const lineString = turf.lineString(this.points);
    return turf.length(lineString);
  }

  // Get the nodes in this section
  getNodes(): string[] {
    return this.nodeIds;
  }
}

// Infrastructure class to handle route calculations and way connections
export class Infra {
  private data: InfraSchema;
  private wayConnectionsCache: Map<string, string[]> = new Map();

  constructor(infraData: InfraSchema) {
    this.data = infraData;
    this.buildConnectionsCache();
  }

  // Build a cache of way connections for efficient lookups
  private buildConnectionsCache(): void {
    this.wayConnectionsCache.clear();

    // For each way, find all ways that share nodes with it
    Object.entries(this.data.ways).forEach(([wayId, way]) => {
      const connections = new Set<string>();

      // Check first and last nodes for connections
      const firstNode = way.nodes[0];
      const lastNode = way.nodes[way.nodes.length - 1];

      Object.entries(this.data.ways).forEach(([otherWayId, otherWay]) => {
        if (wayId === otherWayId) return;

        // Check if other way shares the first or last node
        if (
          otherWay.nodes.includes(firstNode) ||
          otherWay.nodes.includes(lastNode)
        ) {
          connections.add(otherWayId);
        }
      });

      this.wayConnectionsCache.set(wayId, Array.from(connections));
    });
  }

  // Get ways connected to a specific way
  getConnectedWays(wayId: string): string[] {
    return this.wayConnectionsCache.get(wayId) || [];
  }

  // Get ways connected to a specific node
  getWaysConnectedToNode(nodeId: string): string[] {
    return Object.entries(this.data.ways)
      .filter(([_, way]) => way.nodes[0] === nodeId)
      .map(([wayId]) => wayId);
  }

  // Get way data
  getWay(wayId: string) {
    return this.data.ways[wayId];
  }

  // Get node coordinates
  getNodeCoords(nodeId: string): [number, number] | undefined {
    return this.data.node_coords[nodeId];
  }

  // Get all way IDs
  getAllWayIds(): string[] {
    return Object.keys(this.data.ways);
  }

  // Calculate distance of a way
  getWayDistance(wayId: string): number {
    const way = this.data.ways[wayId];
    if (!way || way.nodes.length < 2) return 0;

    const coordinates = way.nodes
      .map((nodeId) => this.data.node_coords[nodeId])
      .filter((coord) => coord != null);

    if (coordinates.length < 2) return 0;

    const lineString = turf.lineString(coordinates);
    return turf.length(lineString);
  }

  // Get coordinates for a way
  getWayCoordinates(wayId: string): [number, number][] {
    const way = this.data.ways[wayId];
    if (!way || way.nodes.length < 2) return [];

    return way.nodes
      .map((nodeId) => this.data.node_coords[nodeId])
      .filter((coord) => coord != null);
  }

  // Get the raw infraData (for backwards compatibility)
  getData(): InfraSchema {
    return this.data;
  }
}

// TrainRoute class to represent a series of connected way sections
export class TrainRoute {
  waySections: WaySection[];
  totalDistance: number;
  sectionDistances: Map<WaySection, number>; // Cumulative distance to start of each section
  infra: Infra;

  constructor(startWayId: string, infra: Infra, maxRouteLength: number = 50) {
    this.waySections = [];
    this.totalDistance = 0;
    this.sectionDistances = new Map();
    this.infra = infra;

    this.buildRoute(startWayId, maxRouteLength);
  }

  // Build a route by following connected ways
  private buildRoute(startWayId: string, maxRouteLength: number): void {
    const visited = new Set<string>();
    let currentWayId = startWayId;
    let cumulativeDistance = 0;

    for (let i = 0; i < maxRouteLength; i++) {
      if (visited.has(currentWayId)) break;

      const way = this.infra.getWay(currentWayId);
      if (!way || way.nodes.length < 2) break;

      // Create a WaySection for the entire way
      const waySection = new WaySection(this.infra, currentWayId);

      // Add current way section to route
      this.waySections.push(waySection);
      this.sectionDistances.set(waySection, cumulativeDistance);
      visited.add(currentWayId);

      // Calculate distance of current way section
      const sectionDistance = waySection.getDistance();
      cumulativeDistance += sectionDistance;

      // Find next connected way using infra
      const endNodeId = way.nodes[way.nodes.length - 1];
      const connectedWays = this.infra
        .getWaysConnectedToNode(endNodeId)
        .filter((wayId) => wayId !== currentWayId && !visited.has(wayId));

      if (connectedWays.length === 0) break;

      // Pick the first connected way (could be randomized)
      currentWayId = connectedWays[0];
    }

    this.totalDistance = cumulativeDistance;
  }

  // Get position along the entire route given way and distance along that way
  getRoutePosition(wayId: string, distanceAlongWay: number): number {
    // Find the way section that contains this wayId
    for (const waySection of this.waySections) {
      if (waySection.wayId === wayId) {
        const sectionStartDistance = this.sectionDistances.get(waySection);
        if (sectionStartDistance === undefined) return 0;
        return sectionStartDistance + distanceAlongWay;
      }
    }
    return 0;
  }

  // Get way section and distance along section given position along route
  getWayPosition(
    routePosition: number
  ): { wayId: string; distanceAlongWay: number } | null {
    let cumulativeDistance = 0;

    for (const waySection of this.waySections) {
      const sectionDistance = waySection.getDistance();
      if (sectionDistance === 0) continue;

      if (
        routePosition >= cumulativeDistance &&
        routePosition <= cumulativeDistance + sectionDistance
      ) {
        return {
          wayId: waySection.wayId,
          distanceAlongWay: routePosition - cumulativeDistance,
        };
      }

      cumulativeDistance += sectionDistance;
    }

    return null;
  }

  // Check if a way is part of this route
  includesWay(wayId: string): boolean {
    return this.waySections.some((section) => section.wayId === wayId);
  }

  // Get all way sections
  getWaySections(): WaySection[] {
    return this.waySections;
  }

  // Get all way IDs (for backwards compatibility)
  getWayIds(): string[] {
    return this.waySections.map((section) => section.wayId);
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
    infra: Infra
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
    this.route = new TrainRoute(wayId, infra);
    this.routePosition = this.route.getRoutePosition(wayId, distanceAlong);

    // Initialize coordinates and bearing
    this.updateCoordinates(infra);
  }

  // Update train position based on velocity and time
  update(deltaTime: number, infra: Infra, otherTrains: Train[]): boolean {
    // Calculate distance to nearest train ahead
    const distanceToTrainAhead = this.getDistanceToTrainAhead(
      otherTrains,
      infra
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
    this.updateCoordinates(infra);

    // Check if train has reached the end of the way
    return this.hasReachedEnd(infra);
  }

  // Calculate distance to the nearest train ahead on the same route
  private getDistanceToTrainAhead(otherTrains: Train[], infra: Infra): number {
    // Find current way section index
    const currentWayIndex = this.route.waySections.findIndex(
      (section) => section.wayId === this.wayId
    );
    if (currentWayIndex === -1) return Number.MAX_SAFE_INTEGER;

    let cumulativeDistance = 0;

    // Start from current segment and check each segment ahead
    for (let i = currentWayIndex; i < this.route.waySections.length; i++) {
      const waySection = this.route.waySections[i];
      const wayId = waySection.wayId;
      const way = infra.getWay(wayId);

      if (!way || way.nodes.length < 2) continue;

      // Calculate segment length using way section
      const segmentLength = waySection.getDistance();
      if (segmentLength === 0) continue;

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
  updateCoordinates(infra: Infra): void {
    const way = infra.getWay(this.wayId);

    if (!way || way.nodes.length < 2) {
      return;
    }

    // Get all coordinates for this way using infra
    const coordinates = infra.getWayCoordinates(this.wayId);

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
  hasReachedEnd(infra: Infra): boolean {
    const way = infra.getWay(this.wayId);

    if (!way || way.nodes.length < 2) {
      return true;
    }

    const lineLength = infra.getWayDistance(this.wayId);
    if (lineLength === 0) {
      return true;
    }

    // Check if we've reached the end of the current way
    return this.distanceAlongKm >= lineLength;
  }

  // Move to next way following the preset route
  moveToNextWay(infra: Infra): boolean {
    // Find the current way section index in the route
    const currentWayIndex = this.route.waySections.findIndex(
      (section) => section.wayId === this.wayId
    );

    if (currentWayIndex === -1) {
      // Current way is not in the route, which shouldn't happen
      return false;
    }

    // Check if there's a next way section in the route
    const nextWayIndex = currentWayIndex + 1;
    if (nextWayIndex >= this.route.waySections.length) {
      // Reached the end of the route, train should disappear
      return false;
    }

    // Get the next way section from the route
    const nextWaySection = this.route.waySections[nextWayIndex];
    const nextWayId = nextWaySection.wayId;
    const nextWay = infra.getWay(nextWayId);

    if (!nextWay || nextWay.nodes.length < 2) {
      // Invalid next way
      return false;
    }

    // Update train position to the next way
    this.wayId = nextWayId;
    this.fromNodeId = nextWaySection.startNodeId;
    this.toNodeId = nextWaySection.endNodeId;
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
  infra: Infra;

  constructor(infra: Infra) {
    this.trains = new Map();
    this.nextTrainId = 1;
    this.infra = infra;
  }

  // Add a new train at a random location
  addRandomTrain(): string | null {
    const wayIds = this.infra.getAllWayIds();
    if (wayIds.length === 0) return null;

    // Pick a random way
    const randomWayId = wayIds[Math.floor(Math.random() * wayIds.length)];
    const way = this.infra.getWay(randomWayId);

    if (!way || way.nodes.length < 2) return null;

    const trainId = `train-${this.nextTrainId++}`;
    const train = new Train(
      trainId,
      randomWayId,
      way.nodes[0],
      way.nodes[way.nodes.length - 1],
      0,
      this.infra
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
      const reachedEnd = train.update(adjustedDeltaTime, this.infra, allTrains);

      if (reachedEnd) {
        // Try to move to next way
        if (!train.moveToNextWay(this.infra)) {
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
  const [infra, setInfra] = useState<Infra | null>(null);
  const lastUpdateTime = useRef<number>(Date.now());
  const animationFrameId = useRef<number | undefined>(undefined);

  // Create infra and train manager when infraData is available
  useEffect(() => {
    if (infraData) {
      const infraInstance = new Infra(infraData);
      setInfra(infraInstance);
      setTrainManager(new TrainManager(infraInstance));
    } else {
      setInfra(null);
      setTrainManager(null);
    }
  }, [infraData]);

  // Animation loop
  const animate = useCallback(() => {
    if (!infra || !isRunning || !trainManager) return;

    const currentTime = Date.now();
    const deltaTime = (currentTime - lastUpdateTime.current) / 1000; // Convert to seconds
    lastUpdateTime.current = currentTime;

    // Update trains with simulation rate
    trainManager.updateTrains(deltaTime, simulationRate);

    // Update state
    setTrains(trainManager.getAllTrains());

    // Continue animation
    animationFrameId.current = requestAnimationFrame(animate);
  }, [infra, isRunning, trainManager, simulationRate]);

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

  // Selected train state
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);

  // Function to select a train
  const selectTrain = (trainId: string | null) => {
    setSelectedTrainId(trainId);
  };

  // Get selected train
  const selectedTrain = useMemo(() => {
    return selectedTrainId
      ? trains.find((train) => train.id === selectedTrainId)
      : null;
  }, [selectedTrainId, trains]);

  // Generate route GeoJSON for selected train
  const getSelectedTrainRoute = useCallback((): GeoJSON.Feature | null => {
    if (!selectedTrain || !infra) return null;

    const routeCoordinates: [number, number][] = [];

    console.log("Way: ", selectedTrain.route.waySections);

    for (const waySection of selectedTrain.route.waySections) {
      const coordinates = waySection.getCoordinates();
      if (coordinates.length < 2) continue;

      // Add coordinates to route, avoiding duplicates at connections
      if (routeCoordinates.length === 0) {
        routeCoordinates.push(...coordinates);
      } else {
        // Skip first coordinate if it's the same as the last one we added
        const lastCoord = routeCoordinates[routeCoordinates.length - 1];
        const firstCoord = coordinates[0];
        if (lastCoord[0] !== firstCoord[0] || lastCoord[1] !== firstCoord[1]) {
          routeCoordinates.push(...coordinates);
        } else {
          routeCoordinates.push(...coordinates.slice(1));
        }
      }
    }

    if (routeCoordinates.length < 2) return null;

    return {
      type: "Feature",
      properties: {
        trainId: selectedTrain.id,
      },
      geometry: {
        type: "LineString",
        coordinates: routeCoordinates,
      },
    };
  }, [selectedTrain, infra]);

  return {
    trains,
    isRunning,
    simulationRate,
    setSimulationRate,
    startSimulation,
    stopSimulation,
    addTrain,
    clearTrains,
    selectedTrainId,
    selectedTrain,
    selectTrain,
    getSelectedTrainRoute,
  };
}
