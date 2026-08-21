import type { DirectionId, BusStop, RouteDirection, RouteSummary, TransitCatalog } from '../../shared/transit-contract';
import { TransitCatalogSchema } from '../../shared/transit-contract';

export interface CatalogRepository {
  readonly catalog: TransitCatalog;
  getRoute(routeId: string): RouteSummary | undefined;
  getDirection(routeId: string, direction: DirectionId): RouteDirection | undefined;
  getDirectionStops(routeId: string, direction: DirectionId): BusStop[];
  searchStops(query: string): BusStop[];
}

export interface CatalogLoadOptions {
  fetch?: typeof globalThis.fetch;
}

export async function loadCatalog(url: string | URL, options: CatalogLoadOptions = {}): Promise<TransitCatalog> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`catalog request failed with HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    throw new Error(`catalog response is not valid JSON: ${reason}`);
  }

  try {
    return TransitCatalogSchema.parse(payload);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`catalog validation failed: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

export function createCatalogRepository(catalog: TransitCatalog): CatalogRepository {
  const routes = new Map(catalog.routes.map((route) => [route.id, route]));
  const stops = new Map(catalog.stops.map((stop) => [stop.id, stop]));

  return {
    catalog,
    getRoute(routeId) {
      return routes.get(routeId.trim());
    },
    getDirection(routeId, direction) {
      return routes.get(routeId.trim())?.directions.find((candidate) => candidate.id === direction);
    },
    getDirectionStops(routeId, direction) {
      const routeDirection = routes.get(routeId.trim())?.directions.find((candidate) => candidate.id === direction);
      if (!routeDirection) {
        return [];
      }
      return routeDirection.stopIds.flatMap((stopId) => {
        const stop = stops.get(stopId);
        return stop ? [stop] : [];
      });
    },
    searchStops(query) {
      const normalized = query.trim().toLocaleLowerCase();
      return catalog.stops.filter((stop) =>
        [stop.id, stop.name, stop.nameCn, stop.nameEn, stop.namePor]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(normalized)),
      );
    },
  };
}

export function findRoute(catalog: TransitCatalog, routeId: string): RouteSummary | undefined {
  return createCatalogRepository(catalog).getRoute(routeId);
}

export function findDirection(catalog: TransitCatalog, routeId: string, direction: DirectionId): RouteDirection | undefined {
  return createCatalogRepository(catalog).getDirection(routeId, direction);
}

export function findDirectionStops(catalog: TransitCatalog, routeId: string, direction: DirectionId): BusStop[] {
  return createCatalogRepository(catalog).getDirectionStops(routeId, direction);
}

export function searchStops(catalog: TransitCatalog, query: string): BusStop[] {
  return createCatalogRepository(catalog).searchStops(query);
}
