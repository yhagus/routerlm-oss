# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Nuxt 4 with Vue 3, Tailwind CSS v4, shadcn-vue and AI Elements Vue (see docs/adr/0011)

## Users

Platform teams operating model routing in production. They need to manage, inspect, and understand traffic sent through an LLM routing gateway.

## Product Purpose

RouterLM is a hosted dashboard for routing and observing LLM traffic. It sits behind standardized client payloads and sends requests to supported model providers, giving platform teams one operational surface for provider routing and gateway activity.

## Positioning

RouterLM provides a provider-neutral LLM routing gateway: clients send one standardized payload while the gateway can route requests across providers such as Alibaba, OpenAI, Anthropic, OpenCode Go, and CommandCode.

## Operating Context

Platform teams use the dashboard while operating production model traffic, checking routing behavior, and observing gateway activity across multiple providers.

## Capabilities and Constraints

- Accept standardized client payloads.
- Route requests to multiple model providers through one gateway.
- Provide dashboard views for routing and LLM traffic observability.
- Confirmed provider examples include Alibaba, OpenAI, Anthropic, OpenCode Go, and CommandCode.
- Additional integrations, routing policies, operational workflows, and deployment details remain undecided.

## Brand Commitments

The product name is RouterLM. It is an LLM Routing Gateway. No further brand, visual, or accessibility constraints are confirmed yet.

## Evidence on Hand

The repository currently contains a minimal Nuxt starter and no product-specific content, operational data, screenshots, testimonials, or other proof assets. Future UI work must not fabricate those materials.

## Product Principles

- Give platform teams one clear control surface for provider-neutral model routing.
- Make production traffic and routing behavior understandable at a glance.
- Keep client integration standardized while provider support can expand.
- Treat operational evidence and current gateway state as the source of truth.

## Accessibility & Inclusion

No product-specific accessibility requirement has been established yet.
