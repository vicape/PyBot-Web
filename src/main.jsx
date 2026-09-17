import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { getLang } from "./i18n.js";
import "./index.css";

document.documentElement.lang = getLang();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
