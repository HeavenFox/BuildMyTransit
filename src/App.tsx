import { useState, useMemo } from "react";
import { TrainSimulator } from "./components/TrainSimulator";
import { RouteDesigner } from "./components/RouteDesigner";
import { useSubwayData } from "./hooks/useSubwayData";
import { Infra } from "./hooks/useTrainSimulation";
import { Settings, Train } from "lucide-react";

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
      {/* Mode Toggle Button */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() =>
            setMode(mode === "simulator" ? "designer" : "simulator")
          }
          className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
        >
          {mode === "simulator" ? (
            <>
              <Settings size={20} />
              <span>Design Routes</span>
            </>
          ) : (
            <>
              <Train size={20} />
              <span>Simulate Trains</span>
            </>
          )}
        </button>
      </div>

      {/* Render the appropriate mode */}
      {mode === "simulator" ? (
        <TrainSimulator
          data={data}
          services={services}
          waysGeoJSON={waysGeoJSON}
          stationsGeoJSON={stationsGeoJSON}
          infra={infra}
        />
      ) : (
        <RouteDesigner
          waysGeoJSON={waysGeoJSON}
          stationsGeoJSON={stationsGeoJSON}
          infra={infra}
        />
      )}
    </div>
  );
}

export default App;
