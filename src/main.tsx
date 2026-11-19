import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/500.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import App from "./app/App.tsx";
import "./styles/index.css";

// Android ilovasida: status bar'ni sozlash va qurilmaning "Orqaga" tugmasini boshqarish.
if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: "#1F6A35" }).catch(() => {});

  // App.tsx "hamyon:back" hodisasiga javob beradi: true -> o'zi hal qildi (masalan, Asosiy tabga qaytdi)
  CapApp.addListener("backButton", () => {
    const ev = new CustomEvent("hamyon:back", { cancelable: true });
    const notHandled = window.dispatchEvent(ev);
    if (notHandled) CapApp.exitApp();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
