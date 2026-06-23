/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["archiver"],
    // Ensure yt-dlp and ffmpeg-static binaries are bundled into the
    // serverless function on Vercel (Next.js 14 requires this under experimental).
    outputFileTracingIncludes: {
      "/api/download": ["./bin/**", "./node_modules/ffmpeg-static/**"],
      "/api/inspect": ["./bin/**", "./node_modules/ffmpeg-static/**"],
    },
  },
};

export default nextConfig;
