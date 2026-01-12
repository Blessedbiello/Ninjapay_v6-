/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ninjapay/types'],
  experimental: {
    serverComponentsExternalPackages: ['@solana/web3.js'],
  },
  env: {
    API_URL: process.env.API_URL || 'http://localhost:8001',
  },
};

module.exports = nextConfig;
