import { useState, useMemo } from "react";
import { TrainSimulator } from "./components/TrainSimulator";
import { RouteDesigner } from "./components/RouteDesigner";
import { useSubwayData } from "./hooks/useSubwayData";
import { Infra } from "./hooks/useTrainSimulation";

function App() {
  const [mode, setMode] = useState<"simulator" | "designer">("simulator");
  const { data, services, waysGeoJSON, stationsGeoJSON, loading, error } =
    useSubwayData();

  const infra = useMemo(() => (data ? new Infra(data) : null), [data]);

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

  if (!infra) {
    return (
      <div className="w-full h-screen flex items-center justify-center">
        <p className="text-lg">Initializing infrastructure...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-screen relative">
      {/* Render the appropriate mode */}
      {mode === "simulator" ? (
        <TrainSimulator
          data={data}
          services={services}
          waysGeoJSON={waysGeoJSON}
          stationsGeoJSON={stationsGeoJSON}
          infra={infra}
          onModeChange={() => setMode("designer")}
        />
      ) : (
        <RouteDesigner
          waysGeoJSON={waysGeoJSON}
          stationsGeoJSON={stationsGeoJSON}
          infra={infra}
          onModeChange={() => setMode("simulator")}
        />
      )}
    </div>
  );
}

export default App;
