/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // typedRoutes regenerates types on build — running typecheck before build sees
  // a stale type for new routes. Re-enable once the route set is stable.
  typedRoutes: false,
};

export default nextConfig;
