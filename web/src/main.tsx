import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./config";
import { errorText } from "./chain";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <main className="shell boot">
    <h1>Kudos.</h1>
    <p role="status">Loading the verified deployment…</p>
  </main>,
);
loadConfig()
  .then((config) => root.render(<App config={config} />))
  .catch((error) =>
    root.render(
      <main className="shell boot">
        <h1>Unable to load Kudos</h1>
        <p role="alert">{errorText(error)}</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload deployment
        </button>
      </main>,
    ),
  );
