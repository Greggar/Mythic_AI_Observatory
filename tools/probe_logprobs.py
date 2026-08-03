#!/usr/bin/env python3
"""Probe the backoffice worker LLM for token logprobs support.

Tests four shapes of request against the worker at 198.51.100.100:12434:
  1. Ollama native  /api/generate        with options.logprobs
  2. Ollama native  /api/generate        with top-level logprobs
  3. OpenAI-compat  /v1/chat/completions with logprobs + top_logprobs
  4. OpenAI-compat  /v1/completions      with logprobs + top_logprobs

Prints exactly what each endpoint returns so we can decide whether the
worker gives us true token distributions (-> real entropy), top-1
logprobs (-> surprisal), or nothing (-> fall back to null).
"""
import argparse
import json
import sys
import time
import urllib.request

MODEL_SHORT = "gpt-oss:20B"  # orchestrator strips the docker.io prefix


def post(url, payload, timeout=90):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode()
            return resp.status, body, time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace"), time.time() - t0
    except Exception as e:
        return None, f"{type(e).__name__}: {e}", time.time() - t0


def summarize(label, status, body, dt):
    print(f"\n=== {label}  (HTTP {status}, {dt:.1f}s) ===")
    if status != 200:
        print("  ! request failed:", body[:500])
        return None
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        print("  ! non-JSON response:", body[:500])
        return None
    print("  top-level keys:", sorted(data.keys()))
    return data


def dump_logprob_keys(prefix, obj, depth=0):
    if not isinstance(obj, dict) or depth > 4:
        return
    for k, v in obj.items():
        if "logprob" in k.lower():
            if isinstance(v, list):
                n = len(v)
                print(f"  {prefix}.{k}: list[{n}]", end="")
                if n and isinstance(v[0], dict):
                    print(" keys:", sorted(v[0].keys()))
                else:
                    print("  first:", str(v[0])[:80] if n else "")
            elif isinstance(v, dict):
                print(f"  {prefix}.{k}: dict keys {sorted(v.keys())}")
            else:
                print(f"  {prefix}.{k}: {str(v)[:80]}")
        dump_logprob_keys(f"{prefix}.{k}", v, depth + 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://198.51.100.100:12434")
    ap.add_argument("--model", default=MODEL_SHORT)
    ap.add_argument("--prompt", default="The capital of France is Paris. Write a short note about weather.")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    print(f"Worker: {base} | model: {args.model}")
    print(f"Prompt: {args.prompt[:60]}...")

    # --- 1. Ollama native with options.logprobs ---
    for n in (1, 5):
        data = summarize(
            f"1. /api/generate  options.logprobs={n}",
            *post(f"{base}/api/generate", {
                "model": args.model, "prompt": args.prompt, "stream": False,
                "options": {"num_ctx": 2048, "logprobs": n},
            }))
        if data:
            dump_logprob_keys("resp", data)

    # --- 2. Ollama native with top-level logprobs ---
    data = summarize(
        "2. /api/generate  top-level logprobs=true",
        *post(f"{base}/api/generate", {
            "model": args.model, "prompt": args.prompt, "stream": False,
            "options": {"num_ctx": 2048}, "logprobs": True,
        }))
    if data:
        dump_logprob_keys("resp", data)

    # --- 3. OpenAI chat completions ---
    data = summarize(
        "3. /v1/chat/completions  logprobs + top_logprobs=5",
        *post(f"{base}/v1/chat/completions", {
            "model": args.model,
            "messages": [{"role": "user", "content": args.prompt}],
            "max_tokens": 64, "temperature": 0.7,
            "logprobs": True, "top_logprobs": 5,
        }))
    if data:
        for i, ch in enumerate(data.get("choices", [])):
            lp = ch.get("logprobs") or {}
            dump_logprob_keys(f"choices[{i}]", ch)
            print(f"  choices[{i}].logprobs keys:", sorted(lp.keys()) if isinstance(lp, dict) else type(lp).__name__)
            for key in ("content", "tokens", "token_logprobs", "top_logprobs"):
                if key in lp and isinstance(lp[key], list):
                    print(f"  choices[{i}].logprobs.{key}: list[{len(lp[key])}]")
                    if lp[key]:
                        print("    sample:", json.dumps(lp[key][0])[:200])

    # --- 4. OpenAI completions (non-chat) ---
    data = summarize(
        "4. /v1/completions  logprobs + top_logprobs=5",
        *post(f"{base}/v1/completions", {
            "model": args.model, "prompt": args.prompt,
            "max_tokens": 64, "temperature": 0.7,
            "logprobs": 5, "top_logprobs": 5,
        }))
    if data:
        for i, ch in enumerate(data.get("choices", [])):
            lp = ch.get("logprobs") or {}
            dump_logprob_keys(f"choices[{i}]", ch)
            print(f"  choices[{i}].logprobs keys:", sorted(lp.keys()) if isinstance(lp, dict) else type(lp).__name__)

    print("\nDONE")


if __name__ == "__main__":
    main()
