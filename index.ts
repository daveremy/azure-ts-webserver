import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";
import { Config } from "@pulumi/pulumi";
import { ServicePrincipalPassword } from "@pulumi/azure/ad";

const deploymentId = pulumi.getStack();

// note: config name must be same as project name specified in pulumi.yaml
const config = new Config("azure-test");
const username = config.require("username");
const password = config.require("password");
const shortName = "aztest"

const resourceGroup = new azure.core.ResourceGroup(shortName, {
    location: config.require("location")
});

// network setup --------------------------------------------------------------
const network = new azure.network.VirtualNetwork(shortName + "-network", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    addressSpaces: ["10.0.0.0/16"]
});

const subnet = new azure.network.Subnet(shortName + "-subnet", {
    resourceGroupName: resourceGroup.name,
    virtualNetworkName: network.name,
    addressPrefix: "10.0.2.0/24"
});

const publicIP = new azure.network.PublicIp(shortName + "-ip", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    publicIpAddressAllocation: "Dynamic"
});

const networkInterface = new azure.network.NetworkInterface(shortName + "-nic", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    ipConfigurations: [{
        name: "webserveripcfg",
        subnetId: subnet.id,
        privateIpAddressAllocation: "Dynamic",
        publicIpAddressId: publicIP.id
    }]
})
// end network setup -----------------------------------------------------------

const userData =
`#!bin/bash
echo "Hello World!" > index.html
nhup python -m SimpleHTTPServer 80 &`;

// create the virtual machine --------------------------------------------------
let vm = new azure.compute.VirtualMachine(shortName + "-vm", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    networkInterfaceIds: [networkInterface.id],
    vmSize: "Standard_A0",
    deleteDataDisksOnTermination: true,
    deleteOsDiskOnTermination: true,
    osProfile: {
        computerName: "hostname",
        adminUsername: username,
        adminPassword: password,
        customData: userData,
    },
    osProfileLinuxConfig: {
        disablePasswordAuthentication: false,
    },
    storageOsDisk: {
        createOption: "FromImage",
        name: "myosdisk1",
    },
    storageImageReference: {
        publisher: "canonical",
        offer: "UbuntuServer",
        sku: "16.04-LTS",
        version: "latest",
    },
});

// The public IP address it not allocated until VM is running, resolve
//  promise (wait for it) to get it.
exports.publicIP = vm.id.apply(async vm => 
    await azure.network.getPublicIP({
        name: publicIP.name,
        resourceGroupName: resourceGroup.name,
    }).then(ip => ip.ipAddress)
);