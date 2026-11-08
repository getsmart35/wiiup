import { LngLatBounds, Map as MLMap, Marker, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';

import type { LngLat } from '../lib/geo';
import { traveledLine, type NavProgress, type NavRoute } from '../lib/navigation';

const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};
type Feature = { type: 'Feature'; properties: object; geometry: { type: 'LineString'; coordinates: LngLat[] } };
const EMPTY: { type: 'FeatureCollection'; features: Feature[] } = { type: 'FeatureCollection', features: [] };
const line = (coords: LngLat[]): Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });

export type CameraMode = 'home' | 'overview' | 'follow';

type Props = {
  dark: boolean;
  center: LngLat;
  route: NavRoute | null;
  progress: NavProgress | null;
  car: { pos: LngLat; bearing: number } | null;
  pickup: LngLat | null;
  dropoff: LngLat | null;
  me: LngLat | null;
  idleCars: LngLat[];
  camera: CameraMode;
  padding: { top: number; bottom: number };
};

function el(className: string, html = '') {
  const d = document.createElement('div');
  d.className = className;
  d.innerHTML = html;
  return d;
}
const CAR_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3 19 20 12 16 5 20z" fill="currentColor"/></svg>';

function addLayers(m: MLMap) {
  if (!m.getSource('route')) m.addSource('route', { type: 'geojson', data: EMPTY });
  if (!m.getSource('route-done')) m.addSource('route-done', { type: 'geojson', data: EMPTY });
  const layout = { 'line-join': 'round', 'line-cap': 'round' } as const;
  if (!m.getLayer('route-casing')) m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout, paint: { 'line-color': '#04140A', 'line-width': 11 } });
  if (!m.getLayer('route-line')) m.addLayer({ id: 'route-line', type: 'line', source: 'route', layout, paint: { 'line-color': '#16C060', 'line-width': 6 } });
  if (!m.getLayer('route-done')) m.addLayer({ id: 'route-done', type: 'line', source: 'route-done', layout, paint: { 'line-color': '#8A938C', 'line-width': 6 } });
}

/** MapLibre GL map behind every screen: basemap, Directions route, traveled overlay, markers, camera. */
export function MapCanvas(p: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const shownDark = useRef(p.dark);
  const markers = useRef<{ car?: Marker; pickup?: Marker; dropoff?: Marker; me?: Marker; idle: Marker[] }>({ idle: [] });
  const shownBearing = useRef(0);

  useEffect(() => {
    const m = new MLMap({
      container: container.current!,
      style: STYLES[p.dark ? 'dark' : 'light'],
      center: p.center,
      zoom: 14.6,
      attributionControl: { compact: true },
    });
    m.on('style.load', () => {
      addLayers(m);
      setStyleVersion((v) => v + 1);
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container.current!);
    return () => {
      ro.disconnect();
      const mk = markers.current;
      [mk.car, mk.pickup, mk.dropoff, mk.me, ...mk.idle].forEach((x) => x?.remove());
      markers.current = { idle: [] };
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (shownDark.current === p.dark) return;
    shownDark.current = p.dark;
    map.current?.setStyle(STYLES[p.dark ? 'dark' : 'light']);
  }, [p.dark]);

  // Route line + traveled overlay
  useEffect(() => {
    const m = map.current;
    if (!m || !styleVersion) return;
    (m.getSource('route') as GeoJSONSource | undefined)?.setData(p.route ? line(p.route.coords) : EMPTY);
    (m.getSource('route-done') as GeoJSONSource | undefined)?.setData(p.route && p.progress ? line(traveledLine(p.route, p.progress)) : EMPTY);
  }, [p.route, p.progress, styleVersion]);

  // Markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const mk = markers.current;
    const place = (key: 'pickup' | 'dropoff' | 'me', at: LngLat | null, make: () => HTMLElement) => {
      if (!at) {
        mk[key]?.remove();
        mk[key] = undefined;
        return;
      }
      if (!mk[key]) mk[key] = new Marker({ element: make() }).setLngLat(at).addTo(m);
      else mk[key]!.setLngLat(at);
    };
    place('me', p.me, () => el('mk-me', '<i></i>'));
    place('pickup', p.pickup, () => el('mk-pin pickup', '<i></i>'));
    place('dropoff', p.dropoff, () => el('mk-pin dropoff', '<i></i>'));

    if (p.car) {
      mk.car ??= new Marker({ element: el('mk-car', CAR_SVG), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(p.car.pos).addTo(m);
      mk.car.setLngLat(p.car.pos).setRotation(p.car.bearing);
    } else {
      mk.car?.remove();
      mk.car = undefined;
    }

    const key = p.idleCars.map((c) => c.join()).join('|');
    if ((mk.idle as Marker[] & { key?: string }).key !== key) {
      mk.idle.forEach((x) => x.remove());
      mk.idle = p.idleCars.map((c, i) => new Marker({ element: el('mk-car idle', CAR_SVG), rotationAlignment: 'map' }).setLngLat(c).setRotation(i * 73).addTo(m));
      (mk.idle as Marker[] & { key?: string }).key = key;
    }
  }, [p.car, p.pickup, p.dropoff, p.me, p.idleCars]);

  // Camera: home / overview
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const padding = { top: p.padding.top, bottom: p.padding.bottom, left: 48, right: 48 };
    if (p.camera === 'home') m.easeTo({ center: p.car?.pos ?? p.center, zoom: 14.6, pitch: 0, bearing: 0, padding, duration: 700 });
    if (p.camera === 'overview') {
      const pts = [...(p.route?.coords ?? []), ...(p.car ? [p.car.pos] : []), ...(p.pickup ? [p.pickup] : []), ...(p.dropoff ? [p.dropoff] : [])];
      if (pts.length < 2) return;
      const b = pts.reduce((acc, c) => acc.extend(c), new LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding, pitch: 0, bearing: 0, duration: 800, maxZoom: 16 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.camera, p.route, p.pickup, p.dropoff, p.padding.bottom, p.center]);

  // Camera: follow (navigation view) — heading-up, pitched, eased bearing
  useEffect(() => {
    const m = map.current;
    if (!m || p.camera !== 'follow' || !p.car) return;
    const diff = ((p.car.bearing - shownBearing.current + 540) % 360) - 180;
    shownBearing.current = (shownBearing.current + diff * 0.12 + 360) % 360;
    m.jumpTo({ center: p.car.pos, zoom: 16.4, pitch: 58, bearing: shownBearing.current, padding: { top: p.padding.top, bottom: p.padding.bottom, left: 0, right: 0 } });
  }, [p.camera, p.car, p.padding.top, p.padding.bottom]);

  return <div ref={container} className="map" />;
}
