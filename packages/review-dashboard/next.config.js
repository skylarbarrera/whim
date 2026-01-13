/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@factory/review-system', '@factory/shared'],
  async rewrites() {
    const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://orchestrator:3000';
    return [
      {
        source: '/api/reviews/:path*',
        destination: `${orchestratorUrl}/api/reviews/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
