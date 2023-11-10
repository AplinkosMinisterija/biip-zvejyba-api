'use strict';

import { find, isEmpty, map } from 'lodash';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { GeomFeatureCollection, coordinatesToGeometry } from '../modules/geometry';
import { CommonFields, CommonPopulates, Table } from '../types';
import { UserAuthMeta } from './api.service';
import { Fishing, FishingType } from './fishings.service';

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

interface Fields extends CommonFields {
  cadastral_id: string;
  name: string;
  municipality: string;
}

interface Populates extends CommonPopulates {}

export type Location<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'locations',
})
export default class LocationsService extends moleculer.Service {
  @Action({
    rest: 'GET /',
    cache: false,
  })
  async search(ctx: Context<any, UserAuthMeta>) {
    const currentFishing: Fishing = await ctx.call('fishings.currentFishing');
    if (!currentFishing) {
      throw new moleculer.Errors.ValidationError('Fishing not started');
    }

    let query = ctx.params.query;

    if (typeof query === 'string') {
      query = JSON.parse(query);
    }

    if (!query?.coordinates) {
      throw new moleculer.Errors.ValidationError('Invalid coordinates');
    }
    const { x, y } = query.coordinates;

    const geom = coordinatesToGeometry({ x: Number(x), y: Number(y) });
    if (currentFishing.type === FishingType.ESTUARY) {
      return this.getBarFromPoint(geom);
    } else if (currentFishing.type === FishingType.INLAND_WATERS) {
      return this.getRiverOrLakeFromPoint(geom);
    } else if (currentFishing.type === FishingType.POLDERS) {
      return this.getPolder(geom);
    } else {
      throw new moleculer.Errors.ValidationError('Invalid fishing type');
    }
  }

  @Action()
  async getLocationsByCadastralIds(ctx: Context<{ locations: string[] }>) {
    const promises = map(ctx.params.locations, (location) =>
      ctx.call('locations.search', { search: location }),
    );

    const result: any = await Promise.all(promises);

    const data: Location[] = [];
    for (const item of result) {
      if (!isEmpty(item)) {
        data.push(item[0]);
      }
    }
    return data;
  }

  @Action({
    rest: 'GET /municipalities',
    cache: {
      ttl: 24 * 60 * 60,
    },
  })
  async getMunicipalities(ctx: Context) {
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
    params: {
      id: 'number',
    },
  })
  async findMunicipalityById(ctx: Context<{ id: number }>) {
    const municipalities = await this.actions.getMunicipalities(null, {
      parentCtx: ctx,
    });
    return find(municipalities?.rows, { id: ctx.params.id });
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

        const municipality = await this.getMunicipalityFromPoint(geom);

        const mappedList = map(features, (item) => {
          const { properties } = item;
          return {
            id: properties['2. Kadastro identifikavimo kodas'],
            name: properties['1. Pavadinimas'],
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
  async getBarFromPoint(geom: GeomFeatureCollection) {
    if (geom?.features?.length) {
      try {
        const box = getBox(geom);
        const bars = `${process.env.GEO_SERVER}/qgisserver/zuvinimas_barai?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&QUERY_LAYERS=fishing_sections&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=1000&X=50&Y=50&SRS=EPSG%3A3346&STYLES=&WIDTH=101&HEIGHT=101&BBOX=${box}`;
        const barsData = await fetch(bars, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await barsData.json();
        const municipality = await this.getMunicipalityFromPoint(geom);

        const mappedList = map(data?.features, (feature) => {
          return {
            id: feature.properties.id,
            name: feature.properties.name,
            municipality: municipality,
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
  async getMunicipalityFromPoint(geom: GeomFeatureCollection) {
    const box = getBox(geom);

    const endPoint = `${process.env.GEO_SERVER}/qgisserver/administrative_boundaries?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&QUERY_LAYERS=municipalities&INFO_FORMAT=application%2Fjson&FEATURE_COUNT=1000&X=50&Y=50&SRS=EPSG%3A3346&STYLES=&WIDTH=101&HEIGHT=101&BBOX=${box}`;
    const data = await fetch(endPoint, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const { features } = await data.json();
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
        municipality: municipality,
      };
    } else {
      throw new moleculer.Errors.ValidationError('Invalid geometry');
    }
  }
}
