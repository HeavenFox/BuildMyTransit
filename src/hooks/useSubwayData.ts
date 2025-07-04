import { useState, useEffect } from "react";
import infraJsonUrl from "@/assets/infra.json?url";
import { waysToGeoJSON, stationsToGeoJSON } from "@/utils/geoJsonUtils";

interface InfraSchema {
  // Node_coords is a mapping of node IDs to their coordinates in [longitude, latitude] format.
  node_coords: {
    [id: string]: [number, number];
  };
  // Ways are individual rail segments. It consists of a list of nodes.
  // The preferred direction is always from the first node to the last node, unless `bidi` is set to true, in which case it can be traversed in both directions.
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

export function useSubwayData() {
  const [data, setData] = useState<InfraSchema | null>(null);
  const [waysGeoJSON, setWaysGeoJSON] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [stationsGeoJSON, setStationsGeoJSON] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        // In a real app, you might want to fetch this from a server
        // For now, we'll assume the data is available in the public directory
        const response = await fetch(infraJsonUrl);
        if (!response.ok) {
          throw new Error("Failed to load subway data");
        }
        const infraData: InfraSchema = await response.json();
        setData(infraData);

        // Convert ways and stations to GeoJSON
        const waysGeoJSON = waysToGeoJSON(infraData);
        const stationsGeoJSON = stationsToGeoJSON(infraData);

        setWaysGeoJSON(waysGeoJSON);
        setStationsGeoJSON(stationsGeoJSON);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  return { data, waysGeoJSON, stationsGeoJSON, loading, error };
}

// Helper function to get all station coordinates for map rendering
export function getStationCoordinates(
  data: InfraSchema
): Array<{ id: string; coords: [number, number]; name: string }> {
  return Object.entries(data.stations).map(([id, station]) => ({
    id,
    coords: station.coords,
    name: station.name,
  }));
}

// Helper function to get all way paths for map rendering
export function getWayPaths(
  data: InfraSchema
): Array<{ id: string; path: [number, number][]; bidi: boolean }> {
  return Object.entries(data.ways).map(([id, way]) => ({
    id,
    path: way.nodes.map((nodeId) => data.node_coords[nodeId]).filter(Boolean),
    bidi: way.bidi || false,
  }));
}
