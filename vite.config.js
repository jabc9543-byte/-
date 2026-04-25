import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// Tauri expects a fixed port; also avoids obscuring Rust errors in console.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: false,
        hmr: {
            protocol: "ws",
            host: "localhost",
            port: 1421,
        },
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
    build: {
        target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
        minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
});
