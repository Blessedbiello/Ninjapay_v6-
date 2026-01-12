import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            NinjaPay
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Confidential payment infrastructure for Solana.
            Privacy-preserving payments powered by Arcium MPC.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <Link href="/dashboard/checkout" className="group">
            <div className="p-8 rounded-xl border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary transition-colors">
                Merchant Checkout
              </h2>
              <p className="text-muted-foreground">
                Accept confidential payments with encrypted amounts.
                Create payment links and manage transactions.
              </p>
            </div>
          </Link>

          <Link href="/dashboard/payroll" className="group">
            <div className="p-8 rounded-xl border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary transition-colors">
                Enterprise Payroll
              </h2>
              <p className="text-muted-foreground">
                Private payroll processing for enterprises.
                Batch payments with confidential amounts.
              </p>
            </div>
          </Link>
        </div>

        <div className="mt-16 text-center">
          <p className="text-sm text-muted-foreground mb-4">Powered by</p>
          <div className="flex items-center justify-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195]" />
              <span className="font-medium">Solana</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/80" />
              <span className="font-medium">Arcium MPC</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
