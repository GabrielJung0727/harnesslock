import { Comparison } from "@/components/Comparison";
import { Features } from "@/components/Features";
import { Footer } from "@/components/Footer";
import { GetStarted } from "@/components/GetStarted";
import { GraphExplorer } from "@/components/GraphExplorer";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Nav } from "@/components/Nav";
import { TerminalDemo } from "@/components/TerminalDemo";
import { Trust } from "@/components/Trust";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <TerminalDemo />
        <GraphExplorer />
        <Features />
        <Comparison />
        <GetStarted />
        <Trust />
      </main>
      <Footer />
    </>
  );
}
