/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ninjapay/types'],
  // Enable standalone output for Docker deployment
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@solana/web3.js'],
  },
  env: {
    API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001',
  },
  // Disable image optimization for standalone (use external CDN in production)
  images: {
    unoptimized: process.env.NODE_ENV === 'production',
  },
};

module.exports = nextConfig;
