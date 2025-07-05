import "maplibre-gl/dist/maplibre-gl.css";
import Map, { Source, Layer } from "react-map-gl/maplibre";
import { useSubwayData } from "./hooks/useSubwayData";
import { useTrainSimulation } from "./hooks/useTrainSimulation";
import type { LayerProps } from "react-map-gl/maplibre";
import { Play, Pause, Plus, Trash2 } from "lucide-react";
import * as turf from "@turf/turf";

function App() {
  const { data, waysGeoJSON, stationsGeoJSON, loading, error } =
    useSubwayData();
  const {
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
  } = useTrainSimulation(data);

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center">
        <p className="text-lg">Loading subway data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-screen flex items-center justify-center">
        <p className="text-lg text-red-500">Error: {error}</p>
      </div>
    );
  }

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
        ["<", ["get", "acceleration"], -3],
        "#ef4444", // Red for emergency braking
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
            wayId: train.wayId,
            routePosition: train.routePosition,
            bearing: bearingDegrees,
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
      <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-4 min-w-[200px]">
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
              onClick={addTrain}
              className="flex items-center gap-2 px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
            >
              <Plus size={16} />
              Add Train
            </button>
          </div>
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
              max="5"
              step="0.1"
              value={simulationRate}
              onChange={(e) => setSimulationRate(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0.1x</span>
              <span>5x</span>
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
                <span>Emergency Braking</span>
              </div>
            </div>
          </div>
          {selectedTrain ? (
            <div className="border-t pt-2 mt-2">
              <h3 className="text-sm font-medium mb-2">Selected Train</h3>
              <div className="bg-purple-50 p-2 rounded border-2 border-purple-200">
                <div className="font-medium text-purple-800">
                  {selectedTrain.id}
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
                  Way ID: {selectedTrain.wayId}
                </div>
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
          {!selectedTrain && trains.length > 0 && (
            <div className="border-t pt-2 mt-2">
              <h3 className="text-sm font-medium mb-2">
                All Trains ({trains.length})
              </h3>
              <div className="max-h-32 overflow-y-auto space-y-1 text-xs">
                {trains.slice(0, 3).map((train) => (
                  <div
                    key={train.id}
                    className="bg-gray-50 p-2 rounded cursor-pointer hover:bg-gray-100"
                    onClick={() => selectTrain(train.id)}
                  >
                    <div className="font-medium">{train.id}</div>
                    <div>
                      Speed: {(train.velocity * 2.23694).toFixed(1)} mph
                    </div>
                    <div>Accel: {train.acceleration.toFixed(2)} m/s²</div>
                    <div>Route Pos: {train.routePosition.toFixed(2)} km</div>
                  </div>
                ))}
                {trains.length > 3 && (
                  <div className="text-gray-500 text-center">
                    ... and {trains.length - 3} more trains
                  </div>
                )}
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

export default App;
