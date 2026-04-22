# topografiko

A simple KAEK-first tool.

Enter a **KAEK** and get:
- parcel geometry and basic parcel details
- context map view
- exports to **DXF**, **GeoJSON**, and **KML**

## What this is

`topografiko` is a lightweight web app for quick parcel lookup and practical export.
It is designed for engineering/academic workflows where you want fast parcel access and clean output files.

## Quick start

```bash
pnpm install
pnpm dev
```

Then open the app, enter a KAEK, and export what you need.

## Build / checks

```bash
pnpm check
pnpm build
```

## Data note

This project uses public geospatial sources for informational use.
It is not a legal extract service.

## Stack

- React + TypeScript + Vite
- Leaflet
- Browser-side export logic (DXF/GeoJSON/KML)
