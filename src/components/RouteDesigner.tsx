import "maplibre-gl/dist/maplibre-gl.css";
import * as turf from "@turf/turf";
import Map, { Source, Layer, type MapRef } from "react-map-gl/maplibre";
import type { LayerProps } from "react-map-gl/maplibre";
import { useAtomValue, useSetAtom } from "jotai";
import { useState, useMemo, useRef } from "react";
import { userRoutesAtom } from "../store/routeStore";
import {
  findCommonElement,
  Infra,
  WaySection,
} from "../hooks/useTrainSimulation";
import {
  ArrowLeft,
  ArrowRight,
  Save,
  X,
  Trash2,
  Undo,
  ChevronDown,
  Train,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";

// NYC Subway line colors
const NYC_SUBWAY_COLORS = [
  { name: "Green", value: "#00933c" },
  { name: "Yellow", value: "#fccc0a" },
  { name: "Orange", value: "#ff6319" },
  { name: "Red", value: "#ee352e" },
  { name: "Purple", value: "#b933ad" },
  { name: "Blue", value: "#0039a6" },
  { name: "Lime", value: "#6cbe45" },
  { name: "Brown", value: "#996633" },
  { name: "Light slate gray", value: "#a7a9ac" },
  { name: "Dark slate gray", value: "#808183" },
  { name: "Turquoise", value: "#00add0" },
] as const;

interface RouteDesignerProps {
  waysGeoJSON: GeoJSON.FeatureCollection | null;
  stationsGeoJSON: GeoJSON.FeatureCollection | null;
  infra: Infra;
  onModeChange: () => void;
}

interface TrackListItemProps {
  wayId: string;
  trackNumber: number;
  infra: Infra;
  onAddWayToRoute: (wayId: string, direction?: "forward" | "backward") => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDirectionHover: (
    direction: { wayId: string; direction: "forward" | "backward" } | null
  ) => void;
}

function TrackListItem({
  wayId,
  trackNumber,
  infra,
  onAddWayToRoute,
  onMouseEnter,
  onMouseLeave,
  onDirectionHover,
}: TrackListItemProps) {
  const way = infra.getWay(wayId);

  return (
    <div
      className="flex gap-2 flex-row items-center p-1 rounded hover:ring-1 hover:ring-neutral-200"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="text-sm grow">Track {trackNumber}</div>
      {way?.bidi ? (
        <>
          <Button
            onClick={() => onAddWayToRoute(wayId, "forward")}
            variant={"secondary"}
            size={"sm"}
            onMouseEnter={() =>
              onDirectionHover({
                wayId: wayId,
                direction: "forward",
              })
            }
            onMouseLeave={() => onDirectionHover(null)}
          >
            <ArrowRight size={16} />
            Add
          </Button>
          <Button
            variant={"secondary"}
            size={"sm"}
            onClick={() => onAddWayToRoute(wayId, "backward")}
            onMouseEnter={() =>
              onDirectionHover({
                wayId: wayId,
                direction: "backward",
              })
            }
            onMouseLeave={() => onDirectionHover(null)}
          >
            <ArrowLeft size={16} />
            Add
          </Button>
        </>
      ) : (
        <Button
          variant={"secondary"}
          size={"sm"}
          onClick={() => onAddWayToRoute(wayId)}
        >
          Add
        </Button>
      )}
    </div>
  );
}

export function RouteDesigner({
  waysGeoJSON,
  infra,
  onModeChange,
}: RouteDesignerProps) {
  const setUserRoutes = useSetAtom(userRoutesAtom);
  const userRoutes = useAtomValue(userRoutesAtom);

  const [hoveredWayId, setHoveredWayId] = useState<string | null>(null);
  const [hoveredDirection, setHoveredDirection] = useState<{
    wayId: string;
    direction: "forward" | "backward";
  } | null>(null);

  const [routeName, setRouteName] = useState("");
  const [routeColor, setRouteColor] = useState("#0039a6"); // Default to A/C/E Blue
  const [routeBullet, setRouteBullet] = useState("");

  const [selectedWayIds, setSelectedWayIds] = useState<string[]>([]);

  const [waySections, setWaySections] = useState<WaySection[]>([]);

  const mapRef = useRef<MapRef>(null);

  const availableWays = useMemo(() => {
    if (waySections.length === 0) {
      return [];
    }

    // Ignore the first node, as that would mean we get rid of that section altogether
    const nodeIds = waySections[waySections.length - 1].getNodes().slice(1);

    const connectedWays: string[] = [];

    for (const wayId of infra.getAllWayIds()) {
      if (waySections.some((section) => section.wayId === wayId)) continue;

      const way = infra.getWay(wayId);
      if (!way) continue;

      for (const nodeId of nodeIds) {
        const index = way.nodes.indexOf(nodeId);
        if (index !== -1) {
          if (way.bidi || index < way.nodes.length - 1) {
            connectedWays.push(wayId);
          }
        }
      }
    }

    return connectedWays;
  }, [waySections, infra]);

  // Create filtered GeoJSON for ways based on design stage
  const selectedWaysGeoJSON = useMemo(() => {
    if (!waysGeoJSON) return null;

    return {
      ...waysGeoJSON,
      features: waysGeoJSON.features.filter((feature) =>
        selectedWayIds.includes(feature.properties?.wayId as string)
      ),
    };
  }, [waysGeoJSON, infra, selectedWayIds, availableWays]);

  const availableWaysGeoJSON = useMemo(() => {
    if (!waysGeoJSON) return null;

    if (waySections.length === 0) {
      return waysGeoJSON;
    }

    return {
      ...waysGeoJSON,
      features: waysGeoJSON.features.filter((feature) =>
        availableWays.includes(feature.properties?.wayId as string)
      ),
    };
  }, [waySections, waysGeoJSON, availableWays]);

  // Create GeoJSON for current route being designed
  const currentRouteGeoJSON = useMemo(() => {
    if (!waySections) return null;

    return turf.featureCollection(
      waySections.map((section) => turf.lineString(section.getCoordinates()))
    );
  }, [waySections, infra]);

  // Create GeoJSON for hovered way
  const hoveredWayGeoJSON = useMemo(() => {
    if (!waysGeoJSON || !hoveredWayId) return null;

    return {
      ...waysGeoJSON,
      features: waysGeoJSON.features.filter(
        (feature) => feature.properties?.wayId === hoveredWayId
      ),
    };
  }, [waysGeoJSON, hoveredWayId]);

  // Create GeoJSON for directional arrows
  const directionalArrowsGeoJSON = useMemo(() => {
    if (!hoveredDirection || !hoveredWayGeoJSON) return null;

    const wayFeature = hoveredWayGeoJSON.features.find(
      (feature) => feature.properties?.wayId === hoveredDirection.wayId
    );

    if (!wayFeature || wayFeature.geometry.type !== "LineString") return null;

    const coordinates = wayFeature.geometry.coordinates;
    const arrows: GeoJSON.Feature<GeoJSON.Point>[] = [];

    // Create arrows along the line
    for (let i = 0; i < coordinates.length - 1; i++) {
      const start = coordinates[i];
      const end = coordinates[i + 1];

      // Calculate midpoint
      const midPoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];

      // Calculate bearing for arrow direction
      let bearing = turf.bearing(turf.point(start), turf.point(end));

      // Reverse bearing for backward direction
      if (hoveredDirection.direction === "backward") {
        bearing = (bearing + 180) % 360;
      }

      arrows.push(
        turf.point(midPoint, {
          bearing: bearing,
          wayId: hoveredDirection.wayId,
        })
      );
    }

    return turf.featureCollection(arrows);
  }, [hoveredDirection, hoveredWayGeoJSON]);

  const addWayToRoute = (
    wayId: string,
    direction: "forward" | "backward" = "forward"
  ) => {
    const newWay = infra.getWay(wayId);
    if (!newWay) return;

    let newSection: WaySection;

    if (waySections.length === 0) {
      // If this is the first section, create it directly
      if (direction === "backward") {
        newSection = new WaySection(
          infra,
          wayId,
          newWay.nodes[newWay.nodes.length - 1] || "",
          newWay.nodes[0] || ""
        );
      } else {
        newSection = new WaySection(
          infra,
          wayId,
          newWay.nodes[0] || "",
          newWay.nodes[newWay.nodes.length - 1] || ""
        );
      }

      setWaySections([newSection]);
    } else {
      const previous = waySections.slice(0, -1);
      let lastSection = waySections[waySections.length - 1];

      const connectingNodeId = findCommonElement(
        lastSection.getNodes(),
        newWay.nodes
      );
      if (!connectingNodeId) return;
      if (connectingNodeId === lastSection.startNodeId) {
        return;
      }

      if (connectingNodeId !== lastSection.endNodeId) {
        lastSection = new WaySection(
          infra,
          lastSection.wayId,
          lastSection.startNodeId,
          connectingNodeId
        );
      }

      if (direction === "backward") {
        newSection = new WaySection(
          infra,
          wayId,
          connectingNodeId,
          newWay.nodes[0]
        );
      } else {
        newSection = new WaySection(
          infra,
          wayId,
          connectingNodeId,
          newWay.nodes[newWay.nodes.length - 1]
        );
      }

      if (newSection.getCoordinates().length < 2) {
        return;
      }

      setWaySections([...previous, lastSection, newSection]);
    }

    setSelectedWayIds([]);
    setHoveredDirection(null);
    setHoveredWayId(null);
  };

  // Handle map click
  const handleMapClick = (event: any) => {
    if (!mapRef.current) return;

    const bbox = [
      [event.point.x - 10, event.point.y - 10],
      [event.point.x + 10, event.point.y + 10],
    ] as [[number, number], [number, number]];
    const selectedFeatures = mapRef.current.queryRenderedFeatures(bbox, {
      layers: ["available-ways"],
    });

    const wayIds = selectedFeatures.map((f) => f.properties.wayId as string);

    setSelectedWayIds(Array.from(new Set(wayIds).values()));
  };

  // Save the current route
  const saveRoute = () => {
    if (waySections.length === 0) return;

    const finalRoute = {
      id: crypto.randomUUID(),
      name: routeName || "My Route",
      color: routeColor,
      bullet: routeBullet || "R",
      waySections: waySections.map((section) => ({
        wayId: section.wayId,
        startNodeId: section.startNodeId,
        endNodeId: section.endNodeId,
      })),
      createdAt: Date.now(),
    };

    setUserRoutes((prev) => [...prev, finalRoute]);
    resetDesigner();
  };

  // Reset the designer
  const resetDesigner = () => {
    setWaySections([]);
    setRouteName("");
    setRouteColor("#0039a6"); // Default to A/C/E Blue
    setRouteBullet("");
  };

  // Delete the last segment
  const deleteLastSegment = () => {
    if (waySections.length > 0) {
      setWaySections(waySections.slice(0, -1));
    }
  };

  // Delete a saved route
  const deleteRoute = (routeId: string) => {
    setUserRoutes((prev) => prev.filter((route) => route.id !== routeId));
  };

  // Define layer styles
  const waysLayerStyle: LayerProps = {
    id: "ways",
    type: "line",
    paint: {
      "line-color": "#a7a9ac",
      "line-width": 2,
      "line-opacity": 0.2,
    },
  };

  const availableWaysLayerStyle: LayerProps = {
    id: "available-ways",
    type: "line",
    paint: {
      "line-color": "#00933c", // Green for available ways
      "line-width": 2,
      "line-opacity": 0.6,
    },
  };

  const selectedWayLayerStyle: LayerProps = {
    id: "selected-ways",
    type: "line",
    paint: {
      "line-color": "#0039a6", // Blue for selected ways
      "line-width": 2,
      "line-opacity": hoveredWayId ? 0.2 : 0.8,
    },
  };

  const currentRouteLayerStyle: LayerProps = {
    id: "current-route",
    type: "line",
    paint: {
      "line-color": "#b933ad", // purple
      "line-width": 2,
      "line-opacity": 0.9,
    },
  };

  const hoveredWayLayerStyle: LayerProps = {
    id: "hovered-way",
    type: "line",
    paint: {
      "line-color": "#0039a6",
      "line-width": 4,
      "line-opacity": 1,
    },
  };

  const directionalArrowsLayerStyle: LayerProps = {
    id: "directional-arrows",
    type: "symbol",
    layout: {
      "text-field": "↑",
      "text-size": 32,
      "text-rotate": ["get", "bearing"],
      "text-rotation-alignment": "map",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-font": ["noto_sans_regular"],
    },
    paint: {
      "text-color": "#0039a6",
      "text-opacity": 0.9,
    },
  };

  return (
    <div className="w-full h-screen relative">
      {/* Control Panel */}
      <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-4 w-80 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Route Designer</h2>
        </div>

        {/* Route Settings */}
        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Route Name
            </label>
            <input
              type="text"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              placeholder="Enter route name"
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Color
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full px-3 py-2 border rounded-md flex items-center justify-between bg-white hover:bg-gray-50">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: routeColor }}
                      />
                      <span className="text-sm">
                        {NYC_SUBWAY_COLORS.find((c) => c.value === routeColor)
                          ?.name || "Custom"}
                      </span>
                    </div>
                    <ChevronDown size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  {NYC_SUBWAY_COLORS.map((color) => (
                    <DropdownMenuItem
                      key={color.value}
                      onClick={() => setRouteColor(color.value)}
                      className="flex items-center gap-2"
                    >
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: color.value }}
                      />
                      <span>{color.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bullet
              </label>
              <input
                type="text"
                value={routeBullet}
                onChange={(e) => setRouteBullet(e.target.value)}
                placeholder="R"
                maxLength={3}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
          </div>
        </div>

        {/* Stage-specific instructions */}
        <div className="mb-4">
          {waySections.length === 0 && selectedWayIds.length === 0 && (
            <p className="text-sm text-gray-700">
              Click on any track to start building your route.
            </p>
          )}
          {selectedWayIds.length > 0 && (
            <div className="space-y-2">
              <div>Selected Tracks</div>
              {selectedWayIds.map((wayId, i) => (
                <TrackListItem
                  key={wayId}
                  wayId={wayId}
                  trackNumber={i + 1}
                  infra={infra}
                  onAddWayToRoute={addWayToRoute}
                  onMouseEnter={() => {
                    setHoveredWayId(wayId);
                    setHoveredDirection(null);
                  }}
                  onMouseLeave={() => setHoveredWayId(null)}
                  onDirectionHover={setHoveredDirection}
                />
              ))}
              <div className="text-xs text-gray-500">
                Hover to see track. May need to zoom in.
              </div>
            </div>
          )}

          {availableWays.length > 0 && selectedWayIds.length === 0 && (
            <div className="space-y-2">
              <div>Available Next Tracks</div>
              {availableWays.map((wayId, i) => (
                <TrackListItem
                  key={wayId}
                  wayId={wayId}
                  trackNumber={i + 1}
                  infra={infra}
                  onAddWayToRoute={addWayToRoute}
                  onMouseEnter={() => {
                    setHoveredWayId(wayId);
                    setHoveredDirection(null);
                  }}
                  onMouseLeave={() => setHoveredWayId(null)}
                  onDirectionHover={setHoveredDirection}
                />
              ))}
              <div className="text-xs text-gray-500">
                Hover to see track. May need to zoom in.
              </div>
            </div>
          )}

          {waySections.length > 0 &&
            selectedWayIds.length === 0 &&
            availableWays.length === 0 && (
              <p className="text-sm text-gray-700">
                You have reached the end of the line
              </p>
            )}
        </div>

        {/* Current Route Info */}
        {waySections && (
          <div className="mb-4 p-3 border rounded-md">
            <h3 className="font-medium mb-2">Current Route</h3>
            <div className="text-sm space-y-1">
              <p>
                <strong>Segments:</strong> {waySections.length}
              </p>
              <div className="max-h-24 overflow-y-auto">
                {waySections.map((section, index) => (
                  <div key={index} className="text-xs text-gray-600">
                    {index + 1}. Way {section.wayId}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          {waySections.length > 0 && (
            <>
              <button
                onClick={saveRoute}
                className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                <Save size={16} />
                Save
              </button>
              <button
                onClick={deleteLastSegment}
                className="flex items-center gap-1 px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
              >
                <Undo size={16} />
                Undo
              </button>
              <button
                onClick={resetDesigner}
                className="flex items-center gap-1 px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              >
                <X size={16} />
                Reset
              </button>
            </>
          )}
        </div>

        {/* Saved Routes */}
        {userRoutes.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h3 className="font-medium mb-2">
              Saved Routes ({userRoutes.length})
            </h3>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {userRoutes.map((route) => (
                <div
                  key={route.id}
                  className="flex items-center gap-2 p-2  rounded"
                >
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: route.color }}
                  />
                  <span className="text-sm font-medium">{route.bullet}</span>
                  <span className="text-sm flex-1 truncate">{route.name}</span>
                  <button
                    onClick={() => deleteRoute(route.id)}
                    className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    title="Delete route"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 border-t mt-2">
          <Button onClick={onModeChange} variant="outline">
            <Train size={16} />
            <span>Back to Simulation</span>
          </Button>
        </div>
      </div>

      <Map
        ref={mapRef}
        initialViewState={{
          longitude: -73.9227753,
          latitude: 40.7096268,
          zoom: 12,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://tiles.versatiles.org/assets/styles/graybeard/style.json"
        onClick={handleMapClick}
        interactiveLayerIds={["available-ways"]}
      >
        {/* Render filtered ways */}
        {waysGeoJSON && (
          <Source id="ways" type="geojson" data={waysGeoJSON}>
            <Layer {...waysLayerStyle} />
          </Source>
        )}

        {/* Render filtered ways */}
        {availableWaysGeoJSON && (
          <Source
            id="available-ways"
            type="geojson"
            data={availableWaysGeoJSON}
          >
            <Layer {...availableWaysLayerStyle} />
          </Source>
        )}
        {/* Render filtered ways */}
        {selectedWaysGeoJSON && (
          <Source id="selected-ways" type="geojson" data={selectedWaysGeoJSON}>
            <Layer {...selectedWayLayerStyle} />
          </Source>
        )}

        {/* Render current route being designed */}
        {currentRouteGeoJSON && (
          <Source id="current-route" type="geojson" data={currentRouteGeoJSON}>
            <Layer {...currentRouteLayerStyle} />
          </Source>
        )}

        {/* Render hovered way */}
        {hoveredWayGeoJSON && (
          <Source id="hovered-way" type="geojson" data={hoveredWayGeoJSON}>
            <Layer {...hoveredWayLayerStyle} />
          </Source>
        )}

        {/* Render directional arrows */}
        {directionalArrowsGeoJSON && (
          <Source
            id="directional-arrows"
            type="geojson"
            data={directionalArrowsGeoJSON}
          >
            <Layer {...directionalArrowsLayerStyle} />
          </Source>
        )}

        {/* Render stations */}
        {/* {stationsGeoJSON && (
          <Source id="stations" type="geojson" data={stationsGeoJSON}>
            <Layer {...stationsLayerStyle} />
          </Source>
        )} */}
      </Map>
    </div>
  );
}
