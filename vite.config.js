import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/firmware/micropython/ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin": {
        target: "https://micropython.org",
        changeOrigin: true,
        rewrite: () => "/resources/firmware/ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin",
      },
    },
  },
});
