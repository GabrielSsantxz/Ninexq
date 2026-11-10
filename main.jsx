import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AdminPage from "./admin-page.jsx";
import AdminRoomPage from "./admin-room-page.jsx";
import "./styles.css";

const path = window.location.pathname.replace(/\/+$/, "");
const Page = path === "/admin"
  ? AdminPage
  : path === "/admin/room"
    ? AdminRoomPage
    : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode><Page /></React.StrictMode>
);
