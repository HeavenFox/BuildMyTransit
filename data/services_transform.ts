import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the OSM data structure for services
interface OSMRelation {
  type: "relation";
  id: number;
  members: Array<{
    type: "node" | "way" | "relation";
    ref: number;
    role: string;
  }>;
  tags?: {
    [key: string]: string;
  };
}

interface OSMServicesData {
  elements: OSMRelation[];
}

// Define the target ServiceSchema structure
interface ServiceSchema {
  services: {
    name: string;
    color: string;
    bullet: string;
    stop_node_ids: string[];
    route_way_ids: string[];
  }[];
}

/**
 * Transform OSM services data to ServiceSchema format
 * Filters to only include routes operated by Metropolitan Transportation Authority (MTA)
 * @param osmData - The OSM data containing route relations
 * @returns Transformed data in ServiceSchema format containing only MTA services
 */
function transformOSMToServiceSchema(osmData: OSMServicesData): ServiceSchema {
  const services: ServiceSchema["services"] = [];

  for (const element of osmData.elements) {
    // Only process route relations for subway services operated by MTA
    if (
      element.type === "relation" &&
      element.tags?.type === "route" &&
      element.tags?.route === "subway" &&
      element.tags?.ref && // Must have a service identifier
      element.tags?.operator === "Metropolitan Transportation Authority"
    ) {
      // Extract stop nodes and route ways from members
      const stopNodeIds: string[] = [];
      const routeWayIds: string[] = [];

      for (const member of element.members) {
        if (member.role === "stop" && member.type === "node") {
          stopNodeIds.push(member.ref.toString());
        } else if (member.role === "" && member.type === "way") {
          // Ways with empty role are typically the route ways
          routeWayIds.push(member.ref.toString());
        }
      }

      // Create the service object
      const service = {
        name: element.tags.name || `${element.tags.ref} Train`,
        color: element.tags.colour || "#000000", // Default to black if no color
        bullet: element.tags.ref, // Use the ref as bullet (e.g., "1", "L", "N")
        stop_node_ids: stopNodeIds,
        route_way_ids: routeWayIds,
      };

      services.push(service);
    }
  }

  return { services };
}

/**
 * Verify the transformed service data integrity
 * @param serviceData - The transformed service data
 */
function verifyTransformedServiceData(serviceData: ServiceSchema): void {
  console.log("Verifying service data integrity...");

  if (!serviceData.services || serviceData.services.length === 0) {
    throw new Error("No services found in transformed data");
  }

  for (const service of serviceData.services) {
    if (!service.name || !service.bullet || !service.color) {
      throw new Error(
        `Invalid service data: missing required fields for service ${
          service.name || service.bullet
        }`
      );
    }

    if (service.stop_node_ids.length === 0) {
      console.warn(`Warning: Service ${service.bullet} has no stop nodes`);
    }

    if (service.route_way_ids.length === 0) {
      console.warn(`Warning: Service ${service.bullet} has no route ways`);
    }
  }

  console.log("Service data integrity verified successfully!");
}

/**
 * Main function to transform MTA services OSM data
 */
async function main() {
  try {
    console.log("Starting MTA services transformation...");

    // Read the OSM services data
    const osmServicesDataPath = path.join(__dirname, "services_osm.json");
    const osmServicesDataRaw = fs.readFileSync(osmServicesDataPath, "utf-8");
    const osmServicesData: OSMServicesData = JSON.parse(osmServicesDataRaw);

    console.log("Processing OSM services data...");
    console.log(`Found ${osmServicesData.elements.length} elements`);
    console.log("Filtering for MTA-operated services only...");

    // Transform the data
    const serviceData = transformOSMToServiceSchema(osmServicesData);

    // Verify the data integrity
    verifyTransformedServiceData(serviceData);

    // Log statistics
    console.log(`Transformed data contains:`);
    console.log(`- ${serviceData.services.length} services`);

    // Log service details
    serviceData.services.forEach((service) => {
      console.log(
        `  - ${service.bullet} (${service.name}): ${service.stop_node_ids.length} stops, ${service.route_way_ids.length} route ways`
      );
    });

    // Write the transformed data
    const outputPath = path.join(__dirname, "services.json");
    fs.writeFileSync(outputPath, JSON.stringify(serviceData, null, 2));

    console.log(`Transformation complete! Output written to ${outputPath}`);
  } catch (error) {
    console.error("Error during transformation:", error);
    process.exit(1);
  }
}

// Run the transformation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { transformOSMToServiceSchema, ServiceSchema };
