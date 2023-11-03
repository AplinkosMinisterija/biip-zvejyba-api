'use strict';

import { find, isEmpty, map } from 'lodash';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import {
  GeomFeatureCollection,
  coordinatesToGeometry,
} from '../modules/geometry';
import {
  CommonFields,
  CommonPopulates,
  LocationType,
  RestrictionType,
  Table,
} from '../types';
import { UserAuthMeta } from './api.service';

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
  F extends keyof (Fields & Populates) = keyof Fields
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'locations',
})
export default class LocationsService extends moleculer.Service {
  @Action({
    rest: 'GET /',
    auth: RestrictionType.PUBLIC,
    cache: false,
  })
  async search(ctx: Context<any, UserAuthMeta>) {
    if (!ctx.params.query?.coordinates) {
      throw new moleculer.Errors.ValidationError('Invalid coordinates');
    }
    const geom = coordinatesToGeometry(
      JSON.parse(ctx.params.query?.coordinates)
    );
    if (ctx.params.query?.type === LocationType.ESTUARY) {
      return this.getBarFromPoint(geom);
    } else if (ctx.params?.query?.type === LocationType.INLAND_WATERS) {
      return this.getRiverOrLakeFromPoint(geom);
    } else {
    }
  }

  @Action()
  async getLocationsByCadastralIds(ctx: Context<{ locations: string[] }>) {
    const promises = map(ctx.params.locations, (location) =>
      ctx.call('locations.search', { search: location })
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
      }
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
        const rivers = `${process.env.GEO_SERVER}/qgisserver/uetk_zuvinimas?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=rivers&OUTPUTFORMAT=application/json&GEOMETRYNAME=centroid&BBOX=${box}`;
        const riversData = await fetch(rivers, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const riversResult = await riversData.json();
        const municipality = await this.getMunicipalityFromPoint(geom);
        const lakes = `${process.env.GEO_SERVER}/qgisserver/uetk_zuvinimas?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=lakes_ponds&OUTPUTFORMAT=application/json&GEOMETRYNAME=centroid&BBOX=${box}`;
        const lakesData = await fetch(lakes, {
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const lakesResult = await lakesData.json();
        const list = [...riversResult.features, ...lakesResult.features];

        const mappedList = map(list, (item) => {
          return {
            id: item.properties.kadastro_id,
            name: item.properties.pavadinimas,
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
  async getBarFromPoint(geom: GeomFeatureCollection) {
    if (geom?.features?.length) {
      try {
        const box = getBox(geom);
        const bars = `${process.env.GEO_SERVER}/qgisserver/zuvinimas_barai?SERVICE=WFS&REQUEST=GetFeature&OUTPUTFORMAT=application/json&TYPENAME=fishing_sections&SRSNAME=3346&BBOX=${box},urn:ogc:def:crs:3346`;
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
    const endPoint = `${process.env.GEO_SERVER}/qgisserver/uetk_zuvinimas?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=municipalities&OUTPUTFORMAT=application/json&BBOX=${box}`;
    const data = await fetch(endPoint, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const { features } = await data.json();
    return {
      id: Number(features[0].properties.kodas),
      name: features[0].properties.pavadinimas,
    };
  }
}
