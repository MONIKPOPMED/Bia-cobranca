import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@/components/ui/sonner";

interface RouterContext {
  queryClient: QueryClient;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          O recurso que você procura não existe ou foi movido.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
          >
            Voltar para o painel
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "cobrAI — Agente de cobrança por voz com IA" },
      {
        name: "description",
        content:
          "cobrAI é a plataforma de cobrança automatizada por voz com IA. Recupera dívidas com tom humano, compliance brasileiro e integração com PIX/boleto.",
      },
      { name: "author", content: "cobrAI" },
      { name: "theme-color", content: "#1a1030" },
      { property: "og:title", content: "cobrAI — Agente de cobrança por voz com IA" },
      {
        property: "og:description",
        content:
          "Agente de cobrança autônomo com voz neural, memória persistente e compliance LGPD.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "cobrAI — Agente de cobrança por voz com IA" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/b442db54-f7f4-414e-8ded-317cbd185044/id-preview-2c30d1db--4f90630f-771b-4790-9b0b-78fa58693ff7.lovable.app-1776703517926.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/b442db54-f7f4-414e-8ded-317cbd185044/id-preview-2c30d1db--4f90630f-771b-4790-9b0b-78fa58693ff7.lovable.app-1776703517926.png" },
      { name: "description", content: "cobrAI is an AI-powered omnichannel customer service platform that clones human agent voices and handles automated responses." },
      { property: "og:description", content: "cobrAI is an AI-powered omnichannel customer service platform that clones human agent voices and handles automated responses." },
      { name: "twitter:description", content: "cobrAI is an AI-powered omnichannel customer service platform that clones human agent voices and handles automated responses." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

