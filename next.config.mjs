/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["archiver"],
    // Bundle the ./bin/ directory (yt-dlp + ffmpeg, copied by prebuild) into
    // each serverless function. Next.js 14 requires this under experimental.
    outputFileTracingIncludes: {
      "/api/download": ["./bin/**"],
      "/api/inspect": ["./bin/**"],
    },
  },
};

export default nextConfig;
