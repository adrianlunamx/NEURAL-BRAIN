import { BrainCanvas } from "./components/BrainCanvas";
import { QueryInput } from "./components/QueryInput";
import { ControlPanel } from "./components/ControlPanel";
import { Hud } from "./components/Hud";
import "./index.css";

export default function App() {
  return (
    <div className="qb-root">
      <BrainCanvas />
      <Hud />
      <ControlPanel />
      <QueryInput />
    </div>
  );
}
