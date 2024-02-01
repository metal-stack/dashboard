//
// SPDX-FileCopyrightText: 2023 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { Netmask } from 'netmask'

import {
  map,
  flatMap,
  uniq,
  compact,
  find,
  some,
  sample,
  includes,
  filter,
  range,
  pick,
  values,
} from '@/lodash'

export function getSpecTemplate (infrastructureKind, defaultWorkerCIDR) {
  switch (infrastructureKind) {
    case 'metal':
      return {
        provider: getProviderTemplate(infrastructureKind, defaultWorkerCIDR),
      }
    default:
      return {
        provider: getProviderTemplate(infrastructureKind, defaultWorkerCIDR),
        networking: {
          nodes: defaultWorkerCIDR,
        },
      }
  }
}

function getProviderTemplate (infrastructureKind, defaultWorkerCIDR) {
  switch (infrastructureKind) {
    case 'aws':
      return {
        type: 'aws',
        infrastructureConfig: {
          apiVersion: 'aws.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'InfrastructureConfig',
          networks: {
            vpc: {
              cidr: defaultWorkerCIDR,
            },
          },
        },
        controlPlaneConfig: {
          apiVersion: 'aws.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'ControlPlaneConfig',
        },
      }
    case 'azure':
      return {
        type: 'azure',
        infrastructureConfig: {
          apiVersion: 'azure.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'InfrastructureConfig',
          networks: {
            vnet: {
              cidr: defaultWorkerCIDR,
            },
            workers: defaultWorkerCIDR,
          },
          zoned: true,
        },
        controlPlaneConfig: {
          apiVersion: 'azure.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'ControlPlaneConfig',
        },
      }
    case 'gcp':
      return {
        type: 'gcp',
        infrastructureConfig: {
          apiVersion: 'gcp.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'InfrastructureConfig',
          networks: {
            workers: defaultWorkerCIDR,
          },
        },
        controlPlaneConfig: {
          apiVersion: 'gcp.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'ControlPlaneConfig',
        },
      }
    case 'openstack':
      return {
        type: 'openstack',
        infrastructureConfig: {
          apiVersion: 'openstack.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'InfrastructureConfig',
          networks: {
            workers: defaultWorkerCIDR,
          },
        },
        controlPlaneConfig: {
          apiVersion: 'openstack.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'ControlPlaneConfig',
        },
      }
    case 'alicloud':
      return {
        type: 'alicloud',
        infrastructureConfig: {
          apiVersion: 'alicloud.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'InfrastructureConfig',
          networks: {
            vpc: {
              cidr: defaultWorkerCIDR,
            },
          },
        },
        controlPlaneConfig: {
          apiVersion: 'alicloud.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'ControlPlaneConfig',
        },
      }
    case 'metal':
      return {
        type: 'metal',
        infrastructureConfig: {
          apiVersion: 'metal.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'InfrastructureConfig',
        },
        controlPlaneConfig: {
          apiVersion: 'metal.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'ControlPlaneConfig',
        },
      }
    case 'vsphere':
      return {
        type: 'vsphere',
        controlPlaneConfig: {
          apiVersion: 'vsphere.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'ControlPlaneConfig',
        },
      }
    case 'hcloud':
      return {
        type: 'hcloud',
        infrastructureConfig: {
          apiVersion: 'hcloud.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'InfrastructureConfig',
          networks: {
            workers: defaultWorkerCIDR,
          },
        },
        controlPlaneConfig: {
          apiVersion: 'hcloud.provider.extensions.gardener.cloud/v1alpha1',
          kind: 'ControlPlaneConfig',
        },
      }
    default:
      return {
        type: infrastructureKind,
      }
  }
}

export function splitCIDR (cidrToSplitStr, numberOfNetworks) {
  if (numberOfNetworks < 1) {
    return []
  }
  const cidrToSplit = new Netmask(cidrToSplitStr)
  const numberOfSplits = Math.ceil(Math.log(numberOfNetworks) / Math.log(2))
  const newBitmask = cidrToSplit.bitmask + numberOfSplits
  if (newBitmask > 32) {
    throw new Error(`Could not split CIDR into ${numberOfNetworks} networks: Not enough bits available`)
  }
  const newCidrBlock = new Netmask(`${cidrToSplit.base}/${newBitmask}`)
  const cidrArray = []
  for (let i = 0; i < numberOfNetworks; i++) {
    cidrArray.push(newCidrBlock.next(i).toString())
  }
  return cidrArray
}

export function getDefaultNetworkConfigurationForAllZones (numberOfZones, infrastructureKind, workerCIDR) {
  switch (infrastructureKind) {
    case 'aws': {
      const zoneNetworksAws = splitCIDR(workerCIDR, numberOfZones)
      return map(range(numberOfZones), index => {
        const bigNetWorks = splitCIDR(zoneNetworksAws[index], 2)
        const workerNetwork = bigNetWorks[0]
        const smallNetworks = splitCIDR(bigNetWorks[1], 2)
        const publicNetwork = smallNetworks[0]
        const internalNetwork = smallNetworks[1]
        return {
          workers: workerNetwork,
          public: publicNetwork,
          internal: internalNetwork,
        }
      })
    }
    case 'alicloud': {
      const zoneNetworksAli = splitCIDR(workerCIDR, numberOfZones)
      return map(range(numberOfZones), index => {
        return {
          workers: zoneNetworksAli[index],
        }
      })
    }
  }
}

export function getDefaultZonesNetworkConfiguration (zones, infrastructureKind, maxNumberOfZones, workerCIDR) {
  const zoneConfigurations = getDefaultNetworkConfigurationForAllZones(maxNumberOfZones, infrastructureKind, workerCIDR)
  if (!zoneConfigurations) {
    return undefined
  }
  return map(zones, (zone, index) => {
    return {
      name: zone,
      ...zoneConfigurations[index],
    }
  })
}

export function findFreeNetworks (existingZonesNetworkConfiguration, workerCIDR, infrastructureKind, maxNumberOfZones) {
  if (!existingZonesNetworkConfiguration) {
    return getDefaultNetworkConfigurationForAllZones(maxNumberOfZones, infrastructureKind, workerCIDR)
  }
  for (let numberOfZones = maxNumberOfZones; numberOfZones >= existingZonesNetworkConfiguration.length; numberOfZones--) {
    const newZonesNetworkConfiguration = getDefaultNetworkConfigurationForAllZones(numberOfZones, infrastructureKind, workerCIDR)
    const freeZoneNetworks = filter(newZonesNetworkConfiguration, networkConfiguration => {
      return !some(existingZonesNetworkConfiguration, networkConfiguration)
    })
    const matchesExistingZoneNetworkSize = newZonesNetworkConfiguration.length - freeZoneNetworks.length === existingZonesNetworkConfiguration.length
    if (newZonesNetworkConfiguration && freeZoneNetworks && matchesExistingZoneNetworkSize) {
      return freeZoneNetworks
    }
  }
  return []
}

export function getZonesNetworkConfiguration (oldZonesNetworkConfiguration, newWorkers, infrastructureKind, maxNumberOfZones, existingShootWorkerCIDR, newShootWorkerCIDR) {
  const newUniqueZones = uniq(flatMap(newWorkers, 'zones'))
  if (!newUniqueZones || !infrastructureKind || !maxNumberOfZones) {
    return undefined
  }

  const workerCIDR = existingShootWorkerCIDR || newShootWorkerCIDR
  const defaultZonesNetworkConfiguration = getDefaultZonesNetworkConfiguration(newUniqueZones, infrastructureKind, maxNumberOfZones, workerCIDR)
  if (!defaultZonesNetworkConfiguration) {
    return undefined
  }

  const existingZonesNetworkConfiguration = compact(map(newUniqueZones, zone => {
    return find(oldZonesNetworkConfiguration, { name: zone })
  }))

  if (existingShootWorkerCIDR) {
    const freeZoneNetworks = findFreeNetworks(existingZonesNetworkConfiguration, existingShootWorkerCIDR, infrastructureKind, maxNumberOfZones)
    const availableNetworksLength = existingZonesNetworkConfiguration.length + freeZoneNetworks.length
    if (availableNetworksLength < newUniqueZones.length) {
      return undefined
    }
    const newZonesNetworkConfiguration = map(newUniqueZones, zone => {
      let zoneConfiguration = find(existingZonesNetworkConfiguration, { name: zone })
      if (zoneConfiguration) {
        return zoneConfiguration
      }
      zoneConfiguration = freeZoneNetworks.shift()
      return {
        name: zone,
        ...zoneConfiguration,
      }
    })

    // order is important => keep oldZonesNetworkConfiguration order
    return uniq([...oldZonesNetworkConfiguration, ...newZonesNetworkConfiguration])
  }

  if (existingZonesNetworkConfiguration.length !== newUniqueZones.length) {
    return defaultZonesNetworkConfiguration
  }

  const usedCIDRS = flatMap(existingZonesNetworkConfiguration, zone => {
    return values(pick(zone, 'workers', 'public', 'internal'))
  })

  const shootCIDR = new Netmask(newShootWorkerCIDR)
  const zoneConfigurationContainsInvalidCIDR = some(usedCIDRS, cidr => {
    return !shootCIDR.contains(cidr)
  })
  if (zoneConfigurationContainsInvalidCIDR) {
    return defaultZonesNetworkConfiguration
  }

  return existingZonesNetworkConfiguration
}

export function getControlPlaneZone (workers, infrastructureKind, oldControlPlaneZone) {
  const workerZones = flatMap(workers, 'zones')
  switch (infrastructureKind) {
    case 'gcp':
    case 'hcloud':
      if (includes(workerZones, oldControlPlaneZone)) {
        return oldControlPlaneZone
      }
      return sample(workerZones)
    default:
      return undefined
  }
}

export function getWorkerProviderConfig (infrastructureKind) {
  switch (infrastructureKind) {
    case 'aws': {
      return {
        apiVersion: 'aws.provider.extensions.gardener.cloud/v1alpha1',
        kind: 'WorkerConfig',
      }
    }
  }
}
