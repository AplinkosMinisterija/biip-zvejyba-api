'use strict';

import centroid from '@turf/centroid';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { GeomFeatureCollection, coordinatesToGeometry } from '../modules/geometry';
import { LocationType, throwNotFoundError } from '../types';
import { UserAuthMeta } from './api.service';
import { FishingType } from './fishings.service';

export const CoordinatesProp = {
  type: 'object',
  properties: {
    x: 'number',
    y: 'number',
  },
};

export type Coordinates = {
  x: number;
  y: number;
};

export const LocationProp = {
  type: 'object',
  properties: {
    id: 'string',
    name: 'string',
    municipality: {
      type: 'object',
      properties: {
        id: 'number',
        name: 'string',
      },
    },
  },
};

export type Location = {
  id: string;
  name: string;
  municipality: {
    id: number;
    name: string;
  };
};

const getBox = (geom: GeomFeatureCollection, tolerance: number = 0.001) => {
  const coordinates: any = geom.features[0].geometry.coordinates;
  const topLeft = {
    lng: coordinates[0] - tolerance,
    lat: coordinates[1] + tolerance,
  };
  const bottomRight = {
    lng: coordinates[0] + tolerance,
    lat: coordinates[1] - tolerance,
  };
  return `${topLeft.lng},${bottomRight.lat},${bottomRight.lng},${topLeft.lat}`;
};

@Service({
  name: 'locations',
})
export default class LocationsService extends moleculer.Service {
  @Action({
    rest: 'GET /',
    cache: false,
  })
  async search(ctx: Context<any, UserAuthMeta>) {
    let query = ctx.params.query;

    if (typeof query === 'string') {
      query = JSON.parse(query);
    }

    if (!query?.coordinates) {
      throw new moleculer.Errors.ValidationError('Invalid coordinates');
    }
    const { x, y } = query.coordinates;

    const geom = coordinatesToGeometry({ x: Number(x), y: Number(y) });
    if (query.type === FishingType.ESTUARY) {
      return this.getFishingSectionFromPoint(geom);
    } else if (query.type === FishingType.INLAND_WATERS) {
      return this.getRiverOrLakeFromPoint(geom);
    } else if (query.type === FishingType.POLDERS) {
      return this.getPolder(geom);
    } else {
      throw new moleculer.Errors.ValidationError('Invalid fishing type');
    }
  }

  @Action({
    params: {
      cadastralId: [{ type: 'string' }, { type: 'array', items: 'string' }],
    },
  })
  async uetkSearchByCadastralId(
    ctx: Context<
      {
        cadastralId: string | string[];
      },
      UserAuthMeta
    >,
  ) {
    const targetUrl = `${process.env.UETK_URL}/objects`;
    const params: any = ctx.params;
    const searchParams = new URLSearchParams(params);
    const multi = typeof ctx.params.cadastralId !== 'string';
    let query;
    if (multi) {
      query = { cadastralId: { $in: ctx.params.cadastralId } };
    } else {
      query = { cadastralId: ctx.params.cadastralId };
    }
    if (!query) return multi ? [] : undefined;

    searchParams.set('query', JSON.stringify(query));
    const queryString = searchParams.toString();

    const url = `${targetUrl}?${queryString}`;

    const data = await fetch(url).then((r) => r.json());
    const locations = data?.rows;
    if (!locations || !locations.length) return multi ? [] : undefined;
    const mappedLocations = locations.map((location: any) => {
      const municipality = { name: location.municipality, id: location.municipalityCode };
      return {
        id: location.cadastralId,
        name: location.name,
        municipality: municipality,
      };
    });
    return multi ? mappedLocations : mappedLocations[0];
  }

  @Action({
    rest: 'GET /municipalities',
    cache: {
      ttl: 24 * 60 * 60,
    },
  })
  async getMunicipalities() {
    const res = await fetch(
      `${process.env.GEO_SERVER}/qgisserver/uetk_zuvinimas?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=municipalities&OUTPUTFORMAT=application/json&propertyName=pavadinimas,kodas`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const data = await res.json();

    const items = data.features
      .map((f: any) => {
        return {
          name: f.properties.pavadinimas,
          id: parseInt(f.properties.kodas),
        };
      })
      .sort((s1: any, s2: any) => {
        return s1.name.localeCompare(s2.name);
      });

    return {
      rows: items,
      total: items.length,
    };
  }

  @Action({
    rest: 'GET /fishing_sections',
    cache: {
      ttl: 24 * 60 * 60,
    },
  })
  async getFishingSections() {
    const url = `${process.env.GEO_SERVER}/api/zuvinimas_barai/collections/fishing_sections/items.json?limit=1000`;
    const fishingSections = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const { features } = await fishingSections.json();
    const sorted = features.sort((a: any, b: any) => {
      const numA = parseInt(a.properties.name.match(/\d+/)[0], 10);
      const numB = parseInt(b.properties.name.match(/\d+/)[0], 10);

      if (numA !== numB) {
        return numA - numB;
      } else {
        return a.properties.name.localeCompare(b.properties.name);
      }
    });

    return await Promise.all(
      sorted.map(async (item: any) => {
        const centerFeature = centroid(item?.geometry);
        const geometry = coordinatesToGeometry({
          x: centerFeature?.geometry?.coordinates[0],
          y: centerFeature?.geometry?.coordinates[1],
        });
        const municipality = await this.getMunicipalityFromPoint(geometry);
        const coordinates = centerFeature?.geometry?.coordinates;
        return {
          x: coordinates[0],
          y: coordinates[1],
          id: item?.properties?.id,
          name: item?.properties?.name,
          municipality,
        };
      }),
    );
  }

  @Method
  async getRiverOrLakeFromPoint(geom: GeomFeatureCollection) {
    if (geom?.features?.length) {
      try {
        const box = getBox(geom, 200);

        const bodyOfWatersUrl = `${process.env.GEO_SERVER}/qgisserver/uetk_public?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&QUERY_LAYERS=upes%2Cezerai_tvenkiniai&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=1000&X=50&Y=50&SRS=EPSG%3A3346&STYLES=&WIDTH=101&HEIGHT=101&BBOX=${box}`;
        const bodyOfWatersData = await fetch(bodyOfWatersUrl, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const { features } = await bodyOfWatersData.json();
        if (!features.length) {
          return null;
        }

        const municipality = await this.getMunicipalityFromPoint(geom);

        const mappedList = features?.map((item: any) => {
          const { properties } = item;
          return {
            id: properties['2. Kadastro identifikavimo kodas'],
            name: properties['1. Pavadinimas'],
            type: LocationType.INLAND_WATERS,
            municipality,
          };
        });

        return mappedList[0];
      } catch (err) {
        throw new moleculer.Errors.ValidationError(err.message);
      }
    } else {
      throw new moleculer.Errors.ValidationError('Invalid geometry');
    }
  }

  @Method
  async getFishingSectionFromPoint(geom: GeomFeatureCollection) {
    if (geom?.features?.length) {
      const box = getBox(geom);
      const bars = `${process.env.GEO_SERVER}/qgisserver/zuvinimas_barai?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&QUERY_LAYERS=fishing_sections&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=1000&X=50&Y=50&SRS=EPSG%3A3346&STYLES=&WIDTH=101&HEIGHT=101&BBOX=${box}`;
      const barsData = await fetch(bars, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const { features } = await barsData.json();
      if (!features?.length) {
        throwNotFoundError('Location not found');
      }
      const municipality = await this.getMunicipalityFromPoint(geom);

      const mappedList = features?.map((feature: any) => {
        return {
          id: feature.properties.id,
          name: feature.properties.name,
          type: LocationType.ESTUARY,
          municipality: municipality,
        };
      });
      const location = mappedList[0];

      if (!location) {
        throwNotFoundError('Location not found');
      }

      return location;
    } else {
      throwNotFoundError('Location not found');
    }
  }

  @Method
  async getMunicipalityFromPoint(geom: GeomFeatureCollection) {
    const box = getBox(geom);
    const endPoint = `${process.env.GEO_SERVER}/qgisserver/administrative_boundaries?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&QUERY_LAYERS=municipalities&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=1000&X=50&Y=50&SRS=EPSG%3A3346&STYLES=&WIDTH=101&HEIGHT=101&BBOX=${box}`;
    const response = await fetch(endPoint, {
      headers: {
        'Content-Type': 'application/json',
      },
    }).then((r) => r.json());

    const features = response.features;
    if (!features.length) {
      return null;
    }

    const { properties } = features[0];

    return {
      id: Number(properties.code),
      name: properties.name,
    };
  }

  @Method
  async getPolder(geom: GeomFeatureCollection) {
    if (geom?.features?.length) {
      const municipality = await this.getMunicipalityFromPoint(geom);
      return {
        id: FishingType.POLDERS,
        name: 'Polderiai',
        type: LocationType.POLDERS,
        municipality: municipality,
      };
    } else {
      throw new moleculer.Errors.ValidationError('Invalid geometry');
    }
  }
}
