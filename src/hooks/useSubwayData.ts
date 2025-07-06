import { useState, useEffect } from "react";
import infraJsonUrl from "@/assets/infra.json?url";
import servicesJsonUrl from "@/assets/services.json?url";
import { waysToGeoJSON, stationsToGeoJSON } from "@/utils/geoJsonUtils";

export interface ServiceSchema {
  services: {
    name: string;
    color: string;
    bullet: string;
    stop_node_ids: string[];
    route_way_ids: string[];
  }[];
}

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
  const [services, setServices] = useState<ServiceSchema | null>(null);
  const [waysGeoJSON, setWaysGeoJSON] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [stationsGeoJSON, setStationsGeoJSON] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load both infrastructure and services data
        const [infraResponse, servicesResponse] = await Promise.all([
          fetch(infraJsonUrl),
          fetch(servicesJsonUrl),
        ]);

        if (!infraResponse.ok) {
          throw new Error("Failed to load infrastructure data");
        }
        if (!servicesResponse.ok) {
          throw new Error("Failed to load services data");
        }

        const infraData: InfraSchema = await infraResponse.json();
        const servicesData: ServiceSchema = await servicesResponse.json();

        setData(infraData);
        setServices(servicesData);

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

  return {
    data,
    services,
    waysGeoJSON,
    stationsGeoJSON,
    loading,
    error,
  };
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
