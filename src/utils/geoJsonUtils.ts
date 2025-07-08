import type { InfraSchema } from "@/hooks/useSubwayData";
import * as turf from "@turf/turf";

export function wayToGeoJSON(data: InfraSchema, nodes: string[]) {
  const coordinates = nodes
    .map((nodeId) => data.node_coords[nodeId])
    .filter((coord) => coord != null);

  return turf.lineString(coordinates);
}

export function waysToGeoJSON(
  data: InfraSchema,
  color?: Map<string, string>
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  Object.entries(data.ways).forEach(([wayId, way]) => {
    // Get coordinates for all nodes in this way
    const coordinates = way.nodes
      .map((nodeId) => data.node_coords[nodeId])
      .filter((coord) => coord != null); // Filter out any missing coordinates

    if (coordinates.length >= 2) {
      // Create a LineString feature using turf.js
      const lineString = turf.lineString(coordinates, {
        wayId: wayId,
        bidi: way.bidi || false,
        nodeCount: coordinates.length,
        color: color?.get(wayId),
      });

      features.push(lineString);
    }
  });

  return turf.featureCollection(features);
}

export function stationsToGeoJSON(
  data: InfraSchema
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  Object.entries(data.stations).forEach(([stationId, station]) => {
    const point = turf.point(station.coords, {
      stationId: stationId,
      name: station.name,
    });

    features.push(point);
  });

  return turf.featureCollection(features);
}
