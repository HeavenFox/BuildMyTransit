import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as turf from "@turf/turf";
import type { InfraSchema, ServiceSchema } from "./useSubwayData";

function findCommonElement(a: string[], b: string[]): string | null {
  for (const item of a) {
    if (b.includes(item)) {
      return item;
    }
  }
  return null;
}

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

  constructor(infraData: InfraSchema) {
    this.data = infraData;
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
  stopNodeIds: string[] = []; // List of stop node IDs
  totalDistance: number;
  sectionDistances: Map<WaySection, number>; // Cumulative distance to start of each section
  infra: Infra;

  name: string = "";
  bullet: string = "";
  color: string = "#000000"; // Default color

  // Cache the route line for stop calculations
  private routeLine: GeoJSON.Feature<GeoJSON.LineString> | null = null;

  // Cache stop positions along the route for efficient distance calculations
  private cachedStopPositions: Array<{
    nodeId: string;
    routePosition: number;
    coordinates: [number, number];
    pointOnRoute: GeoJSON.Feature<GeoJSON.Point>;
  }> | null = null;

  private constructor(infra: Infra) {
    this.waySections = [];
    this.totalDistance = 0;
    this.sectionDistances = new Map();
    this.infra = infra;
  }

  static fromService(
    infra: Infra,
    service: ServiceSchema["services"][number]
  ): TrainRoute {
    const route = new TrainRoute(infra);
    route.name = service.name;
    route.bullet = service.bullet;
    route.color = service.color;
    route.stopNodeIds = service.stop_node_ids;

    // console.group(`Building route for service ${service.name}`);
    // console.log(service.route_way_ids);

    if (service.route_way_ids.length <= 1) {
      route.waySections = service.route_way_ids.map(
        (wayId) => new WaySection(infra, wayId)
      );
    } else {
      const nodes = service.route_way_ids
        .map((wayId) => infra.getWay(wayId)?.nodes)
        .filter((n) => n);
      const startEnds: [string, string][] = nodes.map((nodeIds) => [
        nodeIds[0],
        nodeIds[nodeIds.length - 1],
      ]);

      for (let i = 0; i < startEnds.length - 1; i++) {
        // Find common way that connects these two nodes
        const commonNodeId = findCommonElement(nodes[i], nodes[i + 1]);

        if (commonNodeId) {
          startEnds[i][1] = commonNodeId;
          startEnds[i + 1][0] = commonNodeId;
        } else {
          console.warn(
            `No connecting way found between nodes ${
              service.route_way_ids[i]
            } and ${service.route_way_ids[i + 1]}`
          );
        }
      }

      if (startEnds[0][0] === startEnds[0][1]) {
        startEnds[0][0] = nodes[0][nodes[0].length - 1];
      }
      if (
        startEnds[startEnds.length - 1][0] ===
        startEnds[startEnds.length - 1][1]
      ) {
        startEnds[startEnds.length - 1][1] = nodes[nodes.length - 1][0];
      }

      route.waySections = startEnds.map(([startNodeId, endNodeId], index) => {
        const wayId = service.route_way_ids[index];
        return new WaySection(infra, wayId, startNodeId, endNodeId);
      });
    }

    // console.groupEnd();

    route.buildRoute();
    return route;
  }

  // Build a route by following connected ways
  private buildRoute(): void {
    let cumulativeDistance = 0;

    for (const waySection of this.waySections) {
      this.sectionDistances.set(waySection, cumulativeDistance);

      // Calculate distance of current way section
      const sectionDistance = waySection.getDistance();
      cumulativeDistance += sectionDistance;
    }

    this.totalDistance = cumulativeDistance;
  }

  // Cache stop positions along the route for efficient distance calculations
  private cacheStopPositions(): void {
    if (!this.stopNodeIds || this.stopNodeIds.length === 0) {
      this.cachedStopPositions = [];
      return;
    }

    const routeLine = this.getRouteLine();
    if (!routeLine) {
      this.cachedStopPositions = [];
      return;
    }

    const stops: Array<{
      nodeId: string;
      routePosition: number;
      coordinates: [number, number];
      pointOnRoute: GeoJSON.Feature<GeoJSON.Point>;
    }> = [];

    // Find the position of each stop along the route
    for (const stopNodeId of this.stopNodeIds) {
      const stopCoords = this.infra.getNodeCoords(stopNodeId);
      if (!stopCoords) continue;

      const stopPoint = turf.point(stopCoords);

      // Find the nearest point on the route line to this stop
      const nearestPoint = turf.nearestPointOnLine(routeLine, stopPoint);

      // Get the distance along the route to this nearest point
      const routePosition = Math.max(
        0,
        nearestPoint.properties.location - 0.075
      ); // Platforms are ~150m long, so adjust to center

      stops.push({
        nodeId: stopNodeId,
        routePosition,
        coordinates: stopCoords,
        pointOnRoute: nearestPoint,
      });
    }

    // Sort stops by their position along the route
    stops.sort((a, b) => a.routePosition - b.routePosition);

    this.cachedStopPositions = stops;
  }

  // Force recalculation of cached stop positions if needed
  public invalidateStopCache(): void {
    this.cachedStopPositions = null;
    this.cacheStopPositions();
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

  getCachedStopPositions() {
    if (!this.cachedStopPositions) {
      this.cacheStopPositions();
    }

    if (!this.cachedStopPositions || this.cachedStopPositions.length === 0) {
      return [];
    }

    return this.cachedStopPositions;
  }

  // Get the next stop ahead of the given route position
  getNextStopAhead(
    currentRoutePosition: number,
    lastStopId: string | null = null
  ): {
    nodeId: string;
    routePosition: number;
    coordinates: [number, number];
    distance: number;
  } | null {
    const cachedStopPositions = this.getCachedStopPositions();

    // Find the first stop that's ahead of the current position
    for (const stop of cachedStopPositions) {
      // Skip if this stop is the last one we just departed from
      if (lastStopId && stop.nodeId === lastStopId) {
        continue;
      }
      if (stop.routePosition > currentRoutePosition) {
        return {
          nodeId: stop.nodeId,
          routePosition: stop.routePosition,
          coordinates: stop.coordinates,
          distance: stop.routePosition - currentRoutePosition,
        };
      }
    }

    return null;
  }

  // Get or build the route line for stop calculations
  private getRouteLine(): GeoJSON.Feature<GeoJSON.LineString> | null {
    if (this.routeLine) {
      return this.routeLine;
    }

    // Build the complete route line as a single LineString
    const routeCoordinates: [number, number][] = [];

    for (const waySection of this.waySections) {
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

    if (routeCoordinates.length < 2) {
      return null;
    }

    this.routeLine = turf.lineString(routeCoordinates);
    return this.routeLine;
  }
}

// Train class to represent individual trains
// Now includes stop functionality:
// - Trains will automatically slow down and stop at stations defined in their route
// - They will dwell at stops for a configurable amount of time (dwellTime)
// - During dwell time, trains remain stationary with velocity = 0
// - After dwell time expires, trains resume normal operation
export class Train {
  id: string;

  // Position components
  waySection: WaySection;
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
  slowDownDistance: number = 0.6; // Start slowing down if train ahead is within 600m
  emergencyDistance: number = 0.3; // Emergency braking if train ahead is within 300m

  // Stop management
  isAtStop: boolean = false;
  stopDwellTime: number = 10; // Default dwell time in seconds
  remainingDwellTime: number = 0;
  stopApproachDistance: number = 0.1; // Distance to start slowing down for stops (100m)
  lastStopNodeId: string | null = null; // Track the last stop to prevent immediate re-stopping

  infra: Infra;

  constructor(
    id: string,
    infra: Infra,
    route: TrainRoute,
    dwellTime: number = 10
  ) {
    this.id = id;
    this.waySection = route.waySections[0];
    this.distanceAlongKm = 0;
    this.velocity = 0;
    this.acceleration = 0;
    this.coordinates = [0, 0];
    this.bearing = 0;
    this.route = route;
    this.routePosition = this.route.getRoutePosition(
      this.waySection.wayId,
      this.distanceAlongKm
    );
    this.stopDwellTime = dwellTime;

    this.infra = infra;

    // Initialize coordinates and bearing
    this.updateCoordinates();
  }

  // Update train position based on velocity and time
  update(deltaTime: number, infra: Infra, otherTrains: Train[]): boolean {
    // Handle dwell time if train is at a stop
    if (this.isAtStop) {
      if (this.remainingDwellTime > 0) {
        this.remainingDwellTime -= deltaTime;
        return false; // Still dwelling, do not update position
      } else {
        // Finished dwelling, ready to depart
        this.isAtStop = false;
        this.remainingDwellTime = 0;
      }
    }

    // Calculate distance to nearest train ahead
    const distanceToTrainAhead = this.getDistanceToTrainAhead(
      otherTrains,
      infra
    );

    // Calculate distance to next stop
    const { distance: distanceToNextStop, stopNodeId: nextStopNodeId } =
      this.getDistanceToNextStop();

    // Determine acceleration based on block signaling and stops
    this.calculateAcceleration(distanceToTrainAhead, distanceToNextStop);

    // Apply acceleration
    this.velocity += this.acceleration * deltaTime;

    this.velocity = Math.max(this.velocity, 0);

    // Move the train (always forward)
    const distanceToMove = (this.velocity * deltaTime) / 1000; // Convert to km
    this.distanceAlongKm += distanceToMove;
    this.routePosition += distanceToMove;

    // Check if we've reached or passed the stop position
    // Use a small tolerance (5m) to account for simulation precision
    if (distanceToNextStop <= 0.005) {
      this.isAtStop = true;
      this.lastStopNodeId = nextStopNodeId;
      this.remainingDwellTime = this.stopDwellTime;
    }

    // Update coordinates
    this.updateCoordinates();

    return this.hasReachedEnd(infra);
  }

  // Calculate distance to the nearest train ahead on the same route
  private getDistanceToTrainAhead(otherTrains: Train[], infra: Infra): number {
    // Find current way section index
    const currentWayIndex = this.route.waySections.findIndex(
      (section) => section.wayId === this.waySection.wayId
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
        (train) => train.id !== this.id && train.waySection.wayId === wayId
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

  // Calculate acceleration based on distance to train ahead and stops
  private calculateAcceleration(
    distanceToTrainAhead: number,
    distanceToNextStop?: number
  ): void {
    const maxSpeed = 60 / 2.23694; // 60 mph in m/s

    // Calculate braking distances based on current velocity
    const brakingDistance =
      (this.velocity * this.velocity) / (2 * this.baseDeceleration * 1000); // Convert to km
    const emergencyBrakingDistance =
      (this.velocity * this.velocity) / (2 * this.emergencyDeceleration * 1000); // Convert to km

    // Array to collect all acceleration constraints
    const accelerationOptions: number[] = [];

    // 1. Base acceleration
    accelerationOptions.push(this.baseAcceleration);

    // 2. Zero acceleration if at or above max speed
    if (this.velocity >= maxSpeed) {
      accelerationOptions.push(0);
    }

    // 3. Base deceleration if train in front is closer than braking distance
    if (distanceToTrainAhead <= brakingDistance) {
      accelerationOptions.push(-this.baseDeceleration);
    }

    // 4. Emergency deceleration if train in front is closer than emergency braking distance
    if (distanceToTrainAhead <= emergencyBrakingDistance) {
      accelerationOptions.push(-this.emergencyDeceleration);
    }

    // 5. Stop-based acceleration calculation
    if (
      distanceToNextStop !== undefined &&
      distanceToNextStop < Number.MAX_SAFE_INTEGER &&
      this.velocity > 0
    ) {
      // Calculate what acceleration would bring us to a stop exactly at the stop location
      // Using kinematic equation: v² = u² + 2as, where v=0 (final velocity), u=current velocity, s=distance
      // Solving for a: a = -u²/(2s)
      const distanceToStopInMeters = distanceToNextStop * 1000; // Convert km to meters
      const requiredDeceleration =
        -(this.velocity * this.velocity) / (2 * distanceToStopInMeters);

      if (requiredDeceleration > -this.baseDeceleration) {
        // We need less deceleration than base, so we can speed up, or at least not slow down
        accelerationOptions.push(
          Math.min(this.baseAcceleration, this.acceleration + 0.5)
        );
      } else if (requiredDeceleration <= -this.emergencyDeceleration) {
        // We need more deceleration than emergency, use emergency
        accelerationOptions.push(-this.emergencyDeceleration);
      } else {
        // Use the calculated deceleration
        accelerationOptions.push(requiredDeceleration);
      }
    }

    // The final acceleration is the minimum (most restrictive) of all options
    this.acceleration = Math.min(...accelerationOptions);
  }

  // Update the train's coordinates based on its position along the way
  updateCoordinates(): void {
    // Get all coordinates for this way using infra
    const coordinates = this.waySection.getCoordinates();

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
    const way = infra.getWay(this.waySection.wayId);

    if (!way || way.nodes.length < 2) {
      return true;
    }

    const lineLength = infra.getWayDistance(this.waySection.wayId);
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
      (section) => section.wayId === this.waySection.wayId
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

    // Update train position to the next way section
    this.waySection = nextWaySection;
    this.distanceAlongKm = 0; // Start at beginning of new way

    // Update route position
    this.routePosition = this.route.getRoutePosition(
      nextWaySection.wayId,
      this.distanceAlongKm
    );

    return true;
  }

  // Calculate distance to the next stop on the route
  private getDistanceToNextStop(): {
    distance: number;
    stopNodeId: string | null;
  } {
    const nextStop = this.route.getNextStopAhead(
      this.routePosition,
      this.lastStopNodeId
    );

    if (!nextStop) {
      return { distance: Number.MAX_SAFE_INTEGER, stopNodeId: null };
    }

    return {
      distance: nextStop.distance,
      stopNodeId: nextStop.nodeId,
    };
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
  addTrain(route: TrainRoute, dwellTime: number = 10): string | null {
    const wayIds = this.infra.getAllWayIds();
    if (wayIds.length === 0) return null;

    // Pick a random way
    const randomWayId = wayIds[Math.floor(Math.random() * wayIds.length)];
    const way = this.infra.getWay(randomWayId);

    if (!way || way.nodes.length < 2) return null;

    const trainId = `train-${this.nextTrainId++}`;
    const train = new Train(trainId, this.infra, route, dwellTime);

    // Set initial velocity and acceleration
    train.velocity = 0; // Start with 0 m/s
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
export function useTrainSimulation(
  infraData: InfraSchema | null,
  serviceData: ServiceSchema | null
) {
  const [trainManager, setTrainManager] = useState<TrainManager | null>(null);
  const [trains, setTrains] = useState<Train[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [simulationRate, setSimulationRate] = useState(1);
  const [dwellTime, setDwellTime] = useState(10); // Default dwell time in seconds
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

  const services = useMemo(() => {
    if (!serviceData || !infra) return [];
    return serviceData.services.map((service) =>
      TrainRoute.fromService(infra, service)
    );
  }, [serviceData, infra]);

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
  const addTrain = (route: TrainRoute, customDwellTime?: number) => {
    if (trainManager) {
      trainManager.addTrain(route, customDwellTime ?? dwellTime);
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
    services,
    isRunning,
    simulationRate,
    setSimulationRate,
    dwellTime,
    setDwellTime,
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
