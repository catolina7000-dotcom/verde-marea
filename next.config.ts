import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev не дописывает свой блок в AGENTS.md: правила работы с ИИ здесь ведутся вручную
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
