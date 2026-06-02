"use client";

import { useEffect, useRef } from "react";

const PARTICLE_COUNT = 18;

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  opacity: number;
}

export default function BackgroundAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    if (particlesRef.current.length === 0) {
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.3,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        opacity: Math.random() * 0.3 + 0.05,
      }));
    }

    let t = 0;
    const animate = () => {
      t += 0.005;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // aurora gradients
      const g1 = ctx.createRadialGradient(
        canvas.width * (0.5 + 0.15 * Math.sin(t * 0.3)),
        canvas.height * (0.5 + 0.1 * Math.sin(t * 0.2)),
        0,
        canvas.width * 0.5,
        canvas.height * 0.5,
        canvas.width * 0.6,
      );
      g1.addColorStop(0, "rgba(45, 212, 191, 0.012)");
      g1.addColorStop(0.5, "rgba(251, 191, 36, 0.008)");
      g1.addColorStop(1, "rgba(5, 7, 15, 0)");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const g2 = ctx.createRadialGradient(
        canvas.width * (0.3 + 0.1 * Math.sin(t * 0.4)),
        canvas.height * (0.7 + 0.08 * Math.cos(t * 0.25)),
        0,
        canvas.width * 0.5,
        canvas.height * 0.5,
        canvas.width * 0.5,
      );
      g2.addColorStop(0, "rgba(52, 211, 153, 0.01)");
      g2.addColorStop(1, "rgba(5, 7, 15, 0)");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // particles
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${p.opacity})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
