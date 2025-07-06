import "maplibre-gl/dist/maplibre-gl.css";
import Map, { Source, Layer } from "react-map-gl/maplibre";
import { useTrainSimulation } from "../hooks/useTrainSimulation";
import type { LayerProps } from "react-map-gl/maplibre";
import { Play, Pause, Plus, Trash2 } from "lucide-react";
import * as turf from "@turf/turf";
import { useState, useMemo } from "react";
import { useAtomValue } from "jotai";
import { userRoutesAtom } from "../store/routeStore";
import { Infra, TrainRoute, WaySection } from "../hooks/useTrainSimulation";
import type { InfraSchema, ServiceSchema } from "../hooks/useSubwayData";
import { RouteListItem } from "./RouteListItem";

interface TrainSimulatorProps {
  data: InfraSchema | null;
  services: ServiceSchema | null;
  waysGeoJSON: GeoJSON.FeatureCollection | null;
  stationsGeoJSON: GeoJSON.FeatureCollection | null;
  infra: Infra;
}

function Bullet({
  color,
  letter,
  className,
}: {
  color: string;
  letter: string;
  className?: string;
}) {
  // if letter is shaped like <X>, use a diamond shape
  const isDiamond = letter.startsWith("<") && letter.endsWith(">");
  if (isDiamond) {
    return (
      <div className={className}>
        <div
          className={`w-[70.7%] h-[70.7%] flex items-center justify-center text-white text-xs font-bold transform rotate-45`}
          style={{ backgroundColor: color }}
        >
          <span className="transform -rotate-45">{letter.slice(1, -1)}</span>
        </div>
      </div>
    );
  }
  // otherwise, use a circle shape
  return (
    <div className={className}>
      <div
        className={`w-full h-full flex items-center justify-center text-white text-xs font-bold rounded-full`}
        style={{ backgroundColor: color }}
      >
        {letter}
      </div>
    </div>
  );
}

export function TrainSimulator({
  data,
  services,
  waysGeoJSON,
  stationsGeoJSON,
  infra,
}: TrainSimulatorProps) {
  const userRoutes = useAtomValue(userRoutesAtom);

  // Convert user routes to TrainRoute objects
  const userTrainRoutes = useMemo(() => {
    if (!data || !userRoutes) return [];

    return userRoutes.map((userRoute) =>
      TrainRoute.fromUserRoute(infra, userRoute)
    );
  }, [data, userRoutes, infra]);

  const routes = useMemo(() => {
    if (!services || !infra) return [];
    const serviceRoutes = services.services.map((service) =>
      TrainRoute.fromService(infra, service)
    );
    return serviceRoutes;
  }, [services, infra]);

  const {
    trains,
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
  } = useTrainSimulation(data);

  const [expandedBullet, setExpandedBullet] = useState<string | null>(null);

  // Group routes by bullet (including user routes)
  const routesByBullet = useMemo(() => {
    if (!routes) return {};

    const grouped: { [bullet: string]: typeof routes } = {};
    routes.forEach((route) => {
      if (!grouped[route.bullet]) {
        grouped[route.bullet] = [];
      }
      grouped[route.bullet].push(route);
    });

    return grouped;
  }, [routes]);

  // Add train from specific route
  const addTrainFromRoute = (route: (typeof routes)[0]) => {
    addTrain(route);
  };

  const addRandomTrain = () => {
    if (routes && routes.length > 0) {
      // Select a random route from the available services
      const randomIndex = Math.floor(Math.random() * routes.length);
      const randomRoute = routes[randomIndex];
      // Add a train using the selected route
      addTrain(randomRoute);
    }
  };

  // Function to add 10 trains at once
  const add10Trains = () => {
    for (let i = 0; i < 10; i++) {
      addRandomTrain();
    }
  };

  // Define layer styles
  const waysLayerStyle: LayerProps = {
    id: "subway-ways",
    type: "line",
    paint: {
      "line-color": "#3b82f6",
      "line-width": 2,
      "line-opacity": 0.8,
    },
  };

  const stationsLayerStyle: LayerProps = {
    id: "subway-stations",
    type: "circle",
    paint: {
      "circle-color": "#ef4444",
      "circle-radius": 4,
      "circle-opacity": 0.8,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  };

  const trainsLayerStyle: LayerProps = {
    id: "trains",
    type: "circle",
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "id"], selectedTrainId || ""],
        "#8b5cf6", // Purple for selected train
        ["==", ["get", "isAtStop"], true],
        "#3b82f6", // Blue for trains at stops
        ["==", ["get", "velocity"], 0],
        "#ef4444", // Red for stopped trains
        ["<", ["get", "acceleration"], -0.5],
        "#f59e0b", // Orange for slowing down
        "#10b981", // Green for normal operation
      ],
      "circle-radius": [
        "case",
        ["==", ["get", "id"], selectedTrainId || ""],
        10, // Larger radius for selected train
        8,
      ],
      "circle-opacity": 0.9,
      "circle-stroke-width": [
        "case",
        ["==", ["get", "id"], selectedTrainId || ""],
        3, // Thicker stroke for selected train
        2,
      ],
      "circle-stroke-color": "#ffffff",
    },
  };

  const routeLayerStyle: LayerProps = {
    id: "selected-train-route",
    type: "line",
    paint: {
      "line-color": "#8b5cf6",
      "line-width": 4,
      "line-opacity": 0.8,
      "line-dasharray": [2, 2],
    },
  };

  // Create GeoJSON for trains as points
  const trainsGeoJSON: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: trains
      .filter(
        (train) =>
          train.coordinates &&
          train.coordinates.length === 2 &&
          !isNaN(train.coordinates[0]) &&
          !isNaN(train.coordinates[1])
      )
      .map((train) => {
        // Convert bearing from radians to degrees for MapLibre rotation
        // Ensure bearing is a valid number, default to 0 if not
        const bearingDegrees =
          train.bearing != null && !isNaN(train.bearing)
            ? turf.radiansToDegrees(train.bearing)
            : 0;

        return {
          type: "Feature",
          properties: {
            id: train.id,
            velocity: train.velocity,
            acceleration: train.acceleration,
            wayId: train.waySection.wayId,
            routePosition: train.routePosition,
            bearing: bearingDegrees,
            isAtStop: train.isAtStop,
            remainingDwellTime: train.remainingDwellTime,
          },
          geometry: {
            type: "Point",
            coordinates: train.coordinates,
          },
        };
      }),
  };

  // Handle map click to select trains
  const handleMapClick = (event: any) => {
    const features = event.features;
    if (features && features.length > 0) {
      const clickedFeature = features[0];
      if (clickedFeature.layer.id === "trains") {
        const trainId = clickedFeature.properties.id;
        selectTrain(selectedTrainId === trainId ? null : trainId);
      }
    } else {
      // Clicked on empty area, deselect train
      selectTrain(null);
    }
  };

  // Get selected train route GeoJSON
  const selectedTrainRoute = getSelectedTrainRoute();

  return (
    <div className="w-full h-screen relative">
      {/* Control Panel */}
      <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-4 w-80 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-3">Train Simulator</h2>
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={isRunning ? stopSimulation : startSimulation}
              className="flex items-center gap-2 px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              {isRunning ? <Pause size={16} /> : <Play size={16} />}
              {isRunning ? "Stop" : "Start"}
            </button>
            <button
              onClick={addRandomTrain}
              className="flex items-center gap-2 px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
            >
              <Plus size={16} />
              Add Train
            </button>
          </div>
          <button
            onClick={add10Trains}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors w-full"
          >
            <Plus size={16} />
            Add 10 Trains
          </button>
          <button
            onClick={clearTrains}
            className="flex items-center gap-2 px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors w-full"
          >
            <Trash2 size={16} />
            Clear All
          </button>
          <div className="border-t pt-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Simulation Rate: {simulationRate}x
            </label>
            <input
              type="range"
              min="0.1"
              max="20"
              step="0.1"
              value={simulationRate}
              onChange={(e) => setSimulationRate(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0.1x</span>
              <span>20x</span>
            </div>
          </div>
          <div className="border-t pt-2 mt-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Dwell Time: {dwellTime}s
            </label>
            <input
              type="range"
              min="1"
              max="60"
              step="1"
              value={dwellTime}
              onChange={(e) => setDwellTime(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1s</span>
              <span>60s</span>
            </div>
          </div>
          <div className="text-sm text-gray-600 mt-2">
            Active Trains: {trains.length}
          </div>
          <div className="border-t pt-2 mt-2">
            <h3 className="text-sm font-medium mb-2">Train Status</h3>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                <span>Selected Train</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span>Normal Operation</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <span>Slowing Down</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <span>Stopped</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span>At Station</span>
              </div>
            </div>
          </div>
          {selectedTrain ? (
            <div className="border-t pt-2 mt-2">
              <h3 className="text-sm font-medium mb-2">Selected Train</h3>
              <div className="bg-purple-50 p-2 rounded border-2 border-purple-200">
                <div className="font-medium text-purple-800 text-ellipsis overflow-hidden whitespace-nowrap">
                  {selectedTrain.route.name}
                </div>
                <div className="text-sm text-purple-700">
                  Speed: {(selectedTrain.velocity * 2.23694).toFixed(1)} mph
                </div>
                <div className="text-sm text-purple-700">
                  Accel: {selectedTrain.acceleration.toFixed(2)} m/s²
                </div>
                <div className="text-sm text-purple-700">
                  Route Pos: {selectedTrain.routePosition.toFixed(2)} km
                </div>
                <div className="text-sm text-purple-700">
                  Way ID: {selectedTrain.waySection.wayId}
                </div>
                {selectedTrain.isAtStop && (
                  <div className="text-sm text-red-700 font-medium">
                    At Stop: {selectedTrain.remainingDwellTime.toFixed(1)}s
                    remaining
                  </div>
                )}
                <button
                  onClick={() => selectTrain(null)}
                  className="mt-2 text-xs px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600"
                >
                  Deselect
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t pt-2 mt-2">
              <h3 className="text-sm font-medium mb-2">Train Details</h3>
              <div className="text-xs text-gray-500 text-center py-2">
                Click on a train to see its details and route
              </div>
            </div>
          )}

          {/* Route Selection Section */}
          <div className="border-t pt-2 mt-2">
            <h3 className="text-sm font-medium mb-2">Add Train by Route</h3>
            <div className="flex flex-wrap gap-1">
              {Object.entries(routesByBullet).map(([bullet, bulletRoutes]) => (
                <button
                  key={bullet}
                  onClick={() =>
                    setExpandedBullet(expandedBullet === bullet ? null : bullet)
                  }
                  className={`p-1 rounded ${
                    expandedBullet === bullet
                      ? "bg-gray-200"
                      : "hover:bg-gray-100"
                  }`}
                >
                  <Bullet
                    className="w-6 h-6"
                    color={bulletRoutes[0]?.color || "#000"}
                    letter={bullet}
                  />
                </button>
              ))}
            </div>
            {expandedBullet && (
              <div className="space-y-1 mt-2">
                {routesByBullet[expandedBullet].map((route, index) => (
                  <RouteListItem
                    key={index}
                    route={route}
                    onAdd={addTrainFromRoute}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Custom Routes Section */}
          {userTrainRoutes.length > 0 && (
            <div className="border-t pt-2 mt-2">
              <h3 className="text-sm font-medium mb-2">
                Add Train from Custom Routes
              </h3>
              <div className="space-y-1">
                {userTrainRoutes.map((route, index) => (
                  <RouteListItem
                    key={`custom-${index}`}
                    route={route}
                    onAdd={addTrainFromRoute}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Map
        initialViewState={{
          longitude: -73.9227753,
          latitude: 40.7096268,
          zoom: 12,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://tiles.versatiles.org/assets/styles/graybeard/style.json"
        onClick={handleMapClick}
        interactiveLayerIds={["trains"]}
      >
        {/* Render subway ways */}
        {waysGeoJSON && (
          <Source id="subway-ways" type="geojson" data={waysGeoJSON}>
            <Layer {...waysLayerStyle} />
          </Source>
        )}

        {/* Render subway stations */}
        {stationsGeoJSON && (
          <Source id="subway-stations" type="geojson" data={stationsGeoJSON}>
            <Layer {...stationsLayerStyle} />
          </Source>
        )}

        {/* Render trains */}
        {trains.length > 0 && (
          <Source id="trains" type="geojson" data={trainsGeoJSON}>
            <Layer {...trainsLayerStyle} />
          </Source>
        )}

        {/* Render selected train route */}
        {selectedTrainRoute && (
          <Source
            id="selected-train-route"
            type="geojson"
            data={selectedTrainRoute}
          >
            <Layer {...routeLayerStyle} />
          </Source>
        )}
      </Map>
    </div>
  );
}
