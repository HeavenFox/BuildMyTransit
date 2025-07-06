import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

interface OSMData {
  elements: (OSMNode | OSMWay)[];
}

// Define the target InfraSchema structure
interface InfraSchema {
  node_coords: {
    [id: string]: [number, number];
  };
  ways: {
    [id: string]: {
      nodes: string[];
      bidi?: boolean;
    };
  };
  stations: {
    [id: string]: {
      coords: [number, number];
      name: string;
    };
  };
}

function transformOSMToInfraSchema(osmData: OSMData): InfraSchema {
  const result: InfraSchema = {
    node_coords: {},
    ways: {},
    stations: {},
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

  return result;
}

// Main transformation function
export function transformNYCSubwayData(): void {
  try {
    // Read the OSM data
    const osmDataPath = path.join(__dirname, "osm.json");
    const osmDataRaw = fs.readFileSync(osmDataPath, "utf-8");
    const osmData: OSMData = JSON.parse(osmDataRaw);

    console.log("Processing OSM data...");
    console.log(`Found ${osmData.elements.length} elements`);

    // Transform the data
    const infraData = transformOSMToInfraSchema(osmData);

    // Verify the data integrity
    verifyTransformedData(infraData);

    // Log statistics
    console.log(`Transformed data contains:`);
    console.log(`- ${Object.keys(infraData.node_coords).length} nodes`);
    console.log(`- ${Object.keys(infraData.ways).length} railway ways`);
    console.log(`- ${Object.keys(infraData.stations).length} stations`);

    // Write the transformed data
    const outputPath = path.join(__dirname, "nyc-subway-infra.json");
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

  console.log("=== Verification Complete ===\n");
}

// Export type definitions for use in other modules
export type { InfraSchema, OSMData, OSMNode, OSMWay };

// Utility function to export specific subway lines or areas
export function filterByBoundingBox(
  infraData: InfraSchema,
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number
): InfraSchema {
  const filtered: InfraSchema = {
    node_coords: {},
    ways: {},
    stations: {},
  };

  // Filter nodes within bounding box
  for (const [nodeId, coords] of Object.entries(infraData.node_coords)) {
    const [lon, lat] = coords;
    if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
      filtered.node_coords[nodeId] = coords;
    }
  }

  // Filter ways that have at least one node in the bounding box
  for (const [wayId, way] of Object.entries(infraData.ways)) {
    const hasNodeInBounds = way.nodes.some(
      (nodeId) => filtered.node_coords[nodeId]
    );
    if (hasNodeInBounds) {
      // Only include nodes that are actually in our filtered set
      filtered.ways[wayId] = {
        nodes: way.nodes.filter((nodeId) => filtered.node_coords[nodeId]),
        bidi: way.bidi,
      };
    }
  }

  // Filter stations within bounding box
  for (const [stationId, station] of Object.entries(infraData.stations)) {
    const [lon, lat] = station.coords;
    if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
      filtered.stations[stationId] = station;
    }
  }

  return filtered;
}

// Manhattan bounding box for quick filtering
export function getManhattanSubwayData(infraData: InfraSchema): InfraSchema {
  // Manhattan bounds (approximately)
  return filterByBoundingBox(infraData, -74.02, -73.93, 40.7, 40.83);
}

// Export the transform function for use in other modules
export { transformOSMToInfraSchema };

// Run the transformation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  transformNYCSubwayData();
}
