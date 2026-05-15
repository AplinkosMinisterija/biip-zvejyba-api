// @ts-ignore
import transformation from 'transform-coordinates';
export type CoordinatesPoint = number[];
export type CoordinatesLine = CoordinatesPoint[];
export type CoordinatesPolygon = CoordinatesLine[];
export type CoordinatesMultiPolygon = CoordinatesPolygon[];
export type GeometryObject = {
  type: string;
  coordinates: CoordinatesPoint | CoordinatesLine | CoordinatesPolygon | CoordinatesMultiPolygon;
};

export type GeomFeatureCollection = {
  type: string;
  features: GeomFeature[];
};

export type GeomFeature = {
  type: string;
  properties?: any;
  geometry: GeometryObject;
};

export const GeometryType = {
  POINT: 'Point',
  MULTI_POINT: 'MultiPoint',
  LINE: 'LineString',
  MULTI_LINE: 'MultiLineString',
  POLYGON: 'Polygon',
  MULTI_POLYGON: 'MultiPolygon',
};

export function geometryToGeom(geometry: GeometryObject) {
  return `ST_AsText(ST_GeomFromGeoJSON('${JSON.stringify(geometry)}'))`;
}

export function geometriesToGeomCollection(geometries: GeometryObject[]) {
  return `ST_AsText(ST_Collect(ARRAY(
    SELECT ST_GeomFromGeoJSON(JSON_ARRAY_ELEMENTS('${JSON.stringify(geometries)}'))
  )))`;
}

export function coordinatesToGeometry(coordinates: { x: number; y: number }) {
  const { x, y } = coordinates;
  const transform = transformation('EPSG:4326', '3346');
  const transformed = transform.forward({ x: Number(x), y: Number(y) });
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [transformed.x, transformed.y],
        },
      },
    ],
  };
}

export function geomToWgs(geom: GeomFeatureCollection): { lat: number; lng: number } | null {
  const lks = geom?.features?.[0]?.geometry?.coordinates as CoordinatesPoint | undefined;
  if (!lks || lks.length < 2) return null;
  const transform = transformation('3346', 'EPSG:4326');
  // proj4 returns `{ x: lng, y: lat }` for EPSG:4326 — expose lat/lng
  // explicitly so consumers don't have to remember which axis is which.
  const wgs = transform.forward({ x: lks[0], y: lks[1] });
  return { lat: wgs.y, lng: wgs.x };
}
