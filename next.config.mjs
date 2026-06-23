/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["archiver"],
  },
  // Ensure yt-dlp and ffmpeg-static binaries are included in the
  // serverless function bundle when deploying to Vercel.
  outputFileTracingIncludes: {
    "/api/download": ["./bin/**", "./node_modules/ffmpeg-static/**"],
    "/api/inspect": ["./bin/**", "./node_modules/ffmpeg-static/**"],
  },
};

export default nextConfig;
