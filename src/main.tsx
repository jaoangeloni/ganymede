import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { openStore } from "./lib/store";
import { joinMain, solo } from "./lib/windows";
import "./styles/index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
const render = (app: React.ReactNode) => root.render(<React.StrictMode>{app}</React.StrictMode>);

if (solo) {
  const pane = solo;
  addEventListener("storage", (event) => {
    if (event.key === "ganymede:theme" && event.newValue) document.documentElement.dataset.theme = event.newValue;
  });
  void joinMain(pane).then((joined) =>
    render(<App opened={{ saved: null, persistent: false }} solo={{ pane, ...joined }} />),
  );
} else void openStore().then((opened) => render(<App opened={opened} />));
