//import * as firebase from 'firebase';
import * as functions from 'firebase-functions';
import * as geohash from 'ngeohash';
import * as admin from 'firebase-admin';
import * as parse from 'node-html-parser';

// Start writing Firebase Functions
// https://firebase.google.com/docs/functions/typescript

// export const helloWorld = functions.https.onRequest((request, response) => {
//     response.send("Hello from Firebase!");
// });
//firebase.initializeApp(functions.config().firebase);
admin.initializeApp();
const firestore = admin.firestore();

export const onTeaShopCreate = functions.firestore
    .document("/tea_shops/{shopId}")
    .onCreate((snapshot, context) => {
        const data = snapshot.data();
        if (data === undefined) {
            return null;
        }
        let lat = data.t;
        if (typeof lat === "string") {
            lat = parseFloat(lat);
        }
        let lng = data.g;
        if (typeof lng === "string") {
            lng = parseFloat(lng);
        }
        const hash = geohash.encode(lat, lng);

        let city = data.city;
        let district = data.district;
        let address = data.address;

        if (city === undefined && district === undefined) {
            const result = parseAddress(address);
            city = result[0];
            district = result[1];
            address = result[2];
            // if (address.includes(`市`) && address.includes(`區`)) {
            //     cityIndex = address.indexOf(`市`);
            //     districtIndex = address.indexOf(`區`, cityIndex);
            // }
            // else {
            //     cityIndex = address.indexOf(`縣`);
            //     const districtIndexArr: number[] = [address.indexOf(`鄉`), address.indexOf(`鎮`), address.indexOf(`市`)];
            //     districtIndexArr.sort();
            //     const last = districtIndexArr.pop();
            //     districtIndex = last === undefined ? -1 : last;
            // }
            // city = address.substring(0, cityIndex + 1);
            // district = address.substring(cityIndex + 1, districtIndex + 1);
            // address = address.substring(districtIndex + 1);
        }
        return snapshot.ref.set({
            t: admin.firestore.FieldValue.delete(), g: admin.firestore.FieldValue.delete(),
            city: city, district: district, address: address,
            position: { geopoint: new admin.firestore.GeoPoint(lat, lng), geohash: hash }
        }, { merge: true })
            .catch((error) => {
                console.log(error);
            });
    });
export const parseMilkshopData = functions.https.onRequest(async (req, res) => {
    //Total: 212
    const fetchCount = 10;
    const index = 220; //Change this

    const parser = require('node-html-parser');
    const rp = require('request-promise');
    const mapUrlPrefix = "https://www.google.com.tw/maps/place/";
    const milkShopUrl = "https://www.milkshoptea.com/store_detail.php?uID=22";

    await rp((milkShopUrl)).then(async (html: string) => {
        console.log("currentIndex:" + index);
        const p = parser.parse(html);
        const allData: HTMLElement[] = p.querySelectorAll(".store_box");
        for (let i = index; i < allData.length; i++) {
            if (i > index + fetchCount - 1) {
                break;
            }
            const element = allData[i];
            let branchName;
            let phone;
            let city;
            let district;
            let originalAddress: string = "";
            let address;
            const shopName = "迷客夏";
            const tagH3 = element.querySelector("h3");
            if (tagH3 !== null) {
                tagH3.childNodes.forEach(e => {
                    if (e instanceof parse.TextNode) {
                        branchName = e.rawText;
                    }
                });
            }
            const tagP = element.querySelector("p");
            if (tagP !== null) {
                tagP.childNodes.forEach(e => {
                    if (e instanceof parse.TextNode) {
                        originalAddress = e.rawText.replace(" ", "");
                        const addressInfo: string[] = parseAddress(originalAddress);
                        city = addressInfo[0];
                        district = addressInfo[1];
                        address = addressInfo[2];
                    }
                });
            }
            const tagLi = element.querySelectorAll("li");
            if (tagLi !== null && tagLi.length === 2) {
                const li = tagLi[1];
                if (li instanceof parse.Node) {
                    phone = li.rawText;
                }
            }

            let lat: string = "";
            let lng: string = "";

            const new_rp = require('request-promise');
            await new_rp(mapUrlPrefix + encodeURIComponent(originalAddress)).then((data: string) => {
                const position = parseGeoPosition(data, originalAddress);
                if (position === null || position.length !== 2) {
                    return;
                }
                lat = position[0];
                lng = position[1];

                console.log("Latitude:" + lat + "\nLongitude:" + lng);
            }).catch((err: any) => { console.log(err); });

            if (!isNumberOnly(lat) || !isNumberOnly(lng)) {
                continue;
            }
            await firestore.collection("/tea_shops").add({
                shopName: shopName,
                branchName: branchName,
                city: city,
                district: district,
                address: address,
                phone: phone,
                t: lat,
                g: lng
            });
        }
    });
    res.status(200).send("Success");

    //Return [latitude, longitude]
    function parseGeoPosition(data: string, originalAddress: string): string[] | null {
        const startIndex = data.indexOf(originalAddress);
        if (startIndex < 0) {
            return null;
        }
        const leftBracketPos = data.indexOf("[", startIndex);
        const rightBracketPos = data.indexOf("]", leftBracketPos);
        const str = data.substring(leftBracketPos + 1, rightBracketPos);
        const split = str.split(",");
        const parsedPosition: string[] = [];
        for (const element of split) {
            if (isNumberOnly(element)) {
                parsedPosition.push(element);
            }
            if (parsedPosition.length === 2) {
                break;
            }
        }
        return parsedPosition;
    }
});

//Return [city, district, address]
function parseAddress(address: any): string[] {
    let cityIndex: number;
    let districtIndex: number;

    if (address.includes(`市`) && address.includes(`區`)) {
        cityIndex = address.indexOf(`市`);
        districtIndex = address.indexOf(`區`, cityIndex);
    }
    else {
        cityIndex = address.indexOf(`縣`);
        const districtIndexArr: number[] = [address.indexOf(`鄉`), address.indexOf(`鎮`), address.indexOf(`市`)];
        districtIndexArr.sort();
        const last = districtIndexArr.pop();
        districtIndex = last === undefined ? -1 : last;
    }
    let city: string = address.substring(0, cityIndex + 1);
    if (containsNumber(city)) {
        let startIndex = 0;
        while (containsNumber(address.charAt(startIndex))) {
            startIndex++;
        }
        city = address.substring(startIndex, city.length);
    }
    const district: string = address.substring(cityIndex + 1, districtIndex + 1);
    const newAddress: string = address.substring(districtIndex + 1);
    return [city, district, newAddress];
}

function containsNumber(str: string) {
    return /\d/.test(str);
}

function isNumberOnly(str: string) {
    return /^\d+(\.\d+)?$/.test(str);
}
