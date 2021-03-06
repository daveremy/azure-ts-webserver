import * as azure from "@pulumi/azure";
import * as pulumi from "@pulumi/pulumi";
import { Config } from "@pulumi/pulumi";

// note: config name must be same as project name specified in pulumi.yaml
const config = new Config("azure-test");
const username = config.require("username");
const password = config.require("password");
const shortName = "aztest";

const resourceGroup = new azure.core.ResourceGroup(shortName, {
    location: config.require("location"),
});

// network setup --------------------------------------------------------------
const network = new azure.network.VirtualNetwork(shortName + "-network", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    addressSpaces: ["10.0.0.0/16"],
});

const subnet = new azure.network.Subnet(shortName + "-subnet", {
    resourceGroupName: resourceGroup.name,
    virtualNetworkName: network.name,
    addressPrefix: "10.0.2.0/24",
});

const publicIP = new azure.network.PublicIp(shortName + "-ip", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    publicIpAddressAllocation: "Dynamic",
});

const networkInterface = new azure.network.NetworkInterface(shortName + "-nic", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    ipConfigurations: [{
        name: "webserveripcfg",
        subnetId: subnet.id,
        privateIpAddressAllocation: "Dynamic",
        publicIpAddressId: publicIP.id,
    }],
});
// end network setup -----------------------------------------------------------

const userData =
    `#!bin/bash
echo "Hello World!" > index.html
nhup python -m SimpleHTTPServer 80 &`;

// create the virtual machine --------------------------------------------------
const vm = new azure.compute.VirtualMachine(shortName + "-vm", {
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

// With azure the IP address is not available until the vm is created so use
//  pulumi.all to wait for both the vm to be created (see vm.id below) and the
//  public IP resource to be created.  The function passed to the apply method
//  gets invoked in the post-update phase assuring the azure resources have
//  been created.
exports.publicIP = pulumi.all({ id: vm.id, name: publicIP.name, resourceGroupName: publicIP.resourceGroupName }).apply(ip =>
    azure.network.getPublicIP({
        name: ip.name,
        resourceGroupName: ip.resourceGroupName,
    }).then(ip => ip.ipAddress)
);