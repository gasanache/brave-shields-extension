import { FilterListInfo } from './types';

export const FILTER_LISTS: FilterListInfo[] = [
  {
    id: 'easylist',
    name: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt',
    category: 'ads',
    enabled: true,
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    category: 'privacy',
    enabled: true,
  },
  {
    id: 'ublock_filters',
    name: 'uBlock Filters',
    url: 'https://ublockorigin.github.io/uAssets/filters/filters.txt',
    category: 'ads',
    enabled: true,
  },
  {
    id: 'peter_lowe',
    name: "Peter Lowe's Ad and Tracking Server List",
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
    category: 'ads',
    enabled: true,
  },
  {
    id: 'ublock_privacy',
    name: 'uBlock Filters - Privacy',
    url: 'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
    category: 'privacy',
    enabled: true,
  },
  {
    id: 'ublock_annoyances',
    name: 'uBlock Filters - Annoyances',
    url: 'https://ublockorigin.github.io/uAssets/filters/annoyances-others.txt',
    category: 'annoyances',
    enabled: false,
  },
];
