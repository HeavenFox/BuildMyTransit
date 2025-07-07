import type { InfraSchema } from "@/hooks/useSubwayData";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { centerOfMass, pointToLineDistance } from "@turf/turf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the OSM data structure
interface OSMNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: {
    [key: string]: string;
  };
}

interface OSMWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: {
    [key: string]: string;
  };
}

interface OSMRelation {
  type: "relation";
  id: number;
  members: Array<{
    type: "node" | "way" | "relation";
    ref: number;
    role?: string;
  }>;
  tags?: {
    [key: string]: string;
  };
}

interface OSMData {
  elements: (OSMNode | OSMWay | OSMRelation)[];
}

function transformOSMToInfraSchema(
  osmData: OSMData,
  servicesData: OSMData
): InfraSchema {
  const result: InfraSchema = {
    node_coords: {},
    ways: {},
    stations: {},
    platforms: {},
    way_to_platforms: {},
  };

  // First pass: collect all nodes and identify stations
  const nodes = new Map<number, OSMNode>();

  for (const element of osmData.elements) {
    if (element.type === "node") {
      nodes.set(element.id, element);

      // Add to node_coords (convert from lat/lon to lon/lat for standard GeoJSON format)
      result.node_coords[element.id.toString()] = [element.lon, element.lat];

      // Check if this node is a railway station
      if (
        element.tags?.railway === "station" &&
        (element.tags?.station === "subway" || element.tags?.subway === "yes")
      ) {
        result.stations[element.id.toString()] = {
          coords: [element.lon, element.lat],
          name: element.tags.name || `Station ${element.id}`,
        };
      }
    }
  }

  // Second pass: collect railway ways
  for (const element of osmData.elements) {
    if (element.type === "way" && element.tags?.railway === "subway") {
      // Convert node IDs to strings and filter out any that don't exist
      const nodeIds = element.nodes
        .filter((nodeId) => nodes.has(nodeId))
        .map((nodeId) => nodeId.toString());

      if (nodeIds.length >= 2) {
        const wayData: { nodes: string[]; bidi?: boolean } = {
          nodes: nodeIds,
        };

        // Check if the way is bidirectional
        // Most subway tracks are unidirectional unless specifically marked
        const preferredDirection = element.tags["railway:preferred_direction"];
        if (!preferredDirection || preferredDirection === "both") {
          wayData.bidi = true;
        }

        result.ways[element.id.toString()] = wayData;
      }
    }
  }

  // Third pass: collect platforms and build station-platform relationships
  const platforms = new Map<number, OSMWay>();
  const relationMap = new Map<number, OSMRelation>();

  // First collect all platforms and relations
  for (const element of osmData.elements) {
    if (element.type === "way" && element.tags?.railway === "platform") {
      platforms.set(element.id, element);
    } else if (
      element.type === "relation" &&
      element.tags?.public_transport === "stop_area"
    ) {
      relationMap.set(element.id, element);
    }
  }

  // Process platforms and associate them with stations
  for (const [platformId, platform] of platforms) {
    // Get platform shape coordinates
    const platformCoords = platform.nodes
      .filter((nodeId) => nodes.has(nodeId))
      .map((nodeId) => {
        const node = nodes.get(nodeId)!;
        return [node.lon, node.lat] as [number, number];
      });

    if (platformCoords.length === 0) continue;

    // Calculate centroid using turf
    const lineString = {
      type: "LineString" as const,
      coordinates: platformCoords,
    };
    const centroid = centerOfMass(lineString);

    // Find the station this platform belongs to by looking through relations
    let stationId: string | null = null;

    for (const [, relation] of relationMap) {
      // Check if this relation contains this platform
      const hasPlatform = relation.members.some(
        (member) =>
          member.type === "way" &&
          member.ref === platformId &&
          member.role === "platform"
      );

      if (hasPlatform) {
        // Find the station node in this relation
        const stationMember = relation.members.find(
          (member) =>
            member.type === "node" &&
            (member.role === "stop" || member.role === "")
        );

        if (stationMember) {
          stationId = stationMember.ref.toString();
          break;
        }
      }
    }

    // If we found a station association, add the platform
    result.platforms[platformId.toString()] = {
      centroid: centroid.geometry.coordinates as [number, number],
      shape: platformCoords,
      station_id: stationId,
    };
  }

  // Fourth pass: associate ways with platforms using service data
  // Process service routes to find way-platform associations
  for (const element of servicesData.elements) {
    if (
      element.type === "relation" &&
      element.tags?.type === "route" &&
      element.tags?.route === "subway"
    ) {
      // Extract ways and platforms from this route
      const routeWays: number[] = [];
      const routePlatforms: number[] = [];

      for (const member of element.members) {
        if (member.type === "way") {
          if (member.role === "platform") {
            routePlatforms.push(member.ref);
          } else if (
            member.role === "" ||
            member.role === "forward" ||
            member.role === "backward"
          ) {
            // These are likely the railway ways
            routeWays.push(member.ref);
          }
        }
      }

      // For each platform in this route, find the closest way
      for (const platformId of routePlatforms) {
        const platformIdStr = platformId.toString();
        const platform = result.platforms[platformIdStr];

        if (!platform) {
          console.warn(
            `Platform ${platformIdStr} not found in platforms, skipping association`
          );
          continue;
        }

        if (!platform) continue;

        let closestWayId: string | null = null;
        let minDistance = Infinity;

        // Check each way in this route
        for (const wayId of routeWays) {
          const wayIdStr = wayId.toString();
          const way = result.ways[wayIdStr];

          if (!way) continue;

          // Create a LineString from the way nodes
          const wayCoords = way.nodes
            .map((nodeId) => {
              const coords = result.node_coords[nodeId];
              return coords ? [coords[0], coords[1]] : null;
            })
            .filter((coord) => coord !== null) as [number, number][];

          if (wayCoords.length < 2) continue;

          const lineString = {
            type: "LineString" as const,
            coordinates: wayCoords,
          };

          const platformPoint = {
            type: "Point" as const,
            coordinates: platform.centroid,
          };

          const distance = pointToLineDistance(platformPoint, lineString, {
            units: "meters",
          });

          if (distance < minDistance) {
            minDistance = distance;
            closestWayId = wayIdStr;
          }
        }

        // Associate the platform with the closest way
        if (closestWayId && minDistance < 1000) {
          // Within 1km threshold
          if (!result.way_to_platforms[closestWayId]) {
            result.way_to_platforms[closestWayId] = [];
          }
          if (!result.way_to_platforms[closestWayId].includes(platformIdStr)) {
            result.way_to_platforms[closestWayId].push(platformIdStr);
          }
        }
      }
    }
  }

  return result;
}

// Main transformation function
export function transformNYCSubwayData(): void {
  try {
    // Read the OSM data
    const osmDataPath = path.join(__dirname, "infra_osm.json");
    const osmDataRaw = fs.readFileSync(osmDataPath, "utf-8");
    const osmData: OSMData = JSON.parse(osmDataRaw);

    // Read the services data
    const servicesDataPath = path.join(__dirname, "services_osm.json");
    const servicesDataRaw = fs.readFileSync(servicesDataPath, "utf-8");
    const servicesData: OSMData = JSON.parse(servicesDataRaw);

    console.log("Processing OSM data...");
    console.log(`Found ${osmData.elements.length} infrastructure elements`);
    console.log(`Found ${servicesData.elements.length} service elements`);

    // Transform the data
    const infraData = transformOSMToInfraSchema(osmData, servicesData);

    // Verify the data integrity
    verifyTransformedData(infraData);

    // Log statistics
    console.log(`Transformed data contains:`);
    console.log(`- ${Object.keys(infraData.node_coords).length} nodes`);
    console.log(`- ${Object.keys(infraData.ways).length} railway ways`);
    console.log(`- ${Object.keys(infraData.stations).length} stations`);
    console.log(`- ${Object.keys(infraData.platforms).length} platforms`);
    console.log(
      `- ${
        Object.keys(infraData.way_to_platforms).length
      } way-platform associations`
    );

    // Show some statistics about way-platform associations
    const totalAssociations = Object.values(infraData.way_to_platforms).reduce(
      (sum, platforms) => sum + platforms.length,
      0
    );
    console.log(`- ${totalAssociations} total platform associations`);

    const waysWithPlatforms = Object.values(infraData.way_to_platforms).filter(
      (platforms) => platforms.length > 0
    ).length;
    console.log(`- ${waysWithPlatforms} ways have associated platforms`);

    // Write the transformed data
    const outputPath = path.join(__dirname, "..", "assets", "infra.json");
    fs.writeFileSync(outputPath, JSON.stringify(infraData, null, 2));

    console.log(`Transformation complete! Output written to ${outputPath}`);
  } catch (error) {
    console.error("Error during transformation:", error);
  }
}

// Verification function to check the data integrity
export function verifyTransformedData(infraData: InfraSchema): void {
  console.log("\n=== Data Verification ===");

  // Check that all way nodes exist in node_coords
  let missingNodes = 0;
  let totalWayNodes = 0;

  for (const [wayId, way] of Object.entries(infraData.ways)) {
    for (const nodeId of way.nodes) {
      totalWayNodes++;
      if (!infraData.node_coords[nodeId]) {
        missingNodes++;
        console.warn(`Way ${wayId} references missing node ${nodeId}`);
      }
    }
  }

  console.log(`Checked ${totalWayNodes} way-node references`);
  console.log(`Missing nodes: ${missingNodes}`);

  // Check station coordinates match node coordinates
  let stationNodeMismatches = 0;
  for (const [stationId, station] of Object.entries(infraData.stations)) {
    const nodeCoords = infraData.node_coords[stationId];
    if (nodeCoords) {
      const coordsMatch =
        Math.abs(nodeCoords[0] - station.coords[0]) < 0.0001 &&
        Math.abs(nodeCoords[1] - station.coords[1]) < 0.0001;
      if (!coordsMatch) {
        stationNodeMismatches++;
        console.warn(
          `Station ${stationId} coordinates don't match node coordinates`
        );
      }
    }
  }

  console.log(`Station coordinate mismatches: ${stationNodeMismatches}`);

  // Sample some ways to show bidirectional vs unidirectional
  const bidiWays = Object.entries(infraData.ways).filter(
    ([_, way]) => way.bidi
  );
  const unidiWays = Object.entries(infraData.ways).filter(
    ([_, way]) => !way.bidi
  );

  console.log(`Bidirectional ways: ${bidiWays.length}`);
  console.log(`Unidirectional ways: ${unidiWays.length}`);

  // Verify platform-station relationships
  let platformStationMismatches = 0;
  for (const [platformId, platform] of Object.entries(infraData.platforms)) {
    if (!platform.station_id) {
      console.warn(`Platform ${platformId} has no associated station`);
      platformStationMismatches++;
      continue;
    }
    const stationExists = infraData.stations[platform.station_id];
    if (!stationExists) {
      platformStationMismatches++;
      console.warn(
        `Platform ${platformId} references non-existent station ${platform.station_id}`
      );
    }
  }

  console.log(`Platform-station mismatches: ${platformStationMismatches}`);

  console.log("=== Verification Complete ===\n");
}

// Export type definitions for use in other modules
export type { InfraSchema, OSMData, OSMNode, OSMWay, OSMRelation };

// Export the transform function for use in other modules
export { transformOSMToInfraSchema };

// Run the transformation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  transformNYCSubwayData();
}
