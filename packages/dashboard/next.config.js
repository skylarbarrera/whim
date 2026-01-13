/** @type {import('next').NextConfig} */
const nextConfig = {
  // Rewrite /api/* to orchestrator service
  async rewrites() {
    const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';
    return [
      {
        source: '/api/:path*',
        destination: `${orchestratorUrl}/api/:path*`,
      },
    ];
  },
  // Output standalone for Docker
  output: 'standalone',
};

module.exports = nextConfig;
