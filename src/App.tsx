// The FuelPro app lives in react-app/App.tsx which has its own HashRouter
// with all routes including /founder, /login, /reset-password, etc.
import FuelProApp from "./react-app/App";

export default function App() {
  return <FuelProApp />;
}
