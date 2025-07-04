import * as turf from "@turf/turf";

export interface InfraSchema {
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

export function waysToGeoJSON(data: InfraSchema): GeoJSON.FeatureCollection {
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
