import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Saída standalone: imagem Docker pequena e self-contained (server.js).
  output: "standalone",
};

export default nextConfig;
