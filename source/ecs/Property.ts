/**
 * FF Typescript Foundation Library
 * Copyright 2018 Ralph Wiedemeier, Frame Factory GmbH
 *
 * License: MIT
 */

import { Readonly } from "../types";
import { ValueType, canConvert } from "./convert";
import Properties from "./Properties";
import PropertyLink from "./PropertyLink";

/////////////////////////////////////////////////////////////////////////////////

export type PropertyType = ValueType;

export type PresetOrSchema<T> = T | IPropertySchema<T>;

export interface IPropertySchema<T = any>
{
    preset: T;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    labels?: string[];
    multi?: boolean;
    semantic?: string;
}

export interface ISerializedProperty
{
    path?: string;
    key?: string;
    schema?: IPropertySchema;
    inLinks?: string[];
    outLinks?: string[];
    value?: any;
}

export default class Property<T = any>
{
    parent: Properties;
    key: string;

    value: T;
    changed: boolean;

    readonly path: string;
    readonly preset: T;
    readonly elements: number;
    readonly type: PropertyType;
    readonly schema: Readonly<IPropertySchema<T>>;

    readonly inLinks: PropertyLink[];
    readonly outLinks: PropertyLink[];

    constructor(path: string, presetOrSchema: PresetOrSchema<T>, preset?: T)
    {
        const isSchema = typeof presetOrSchema === "object" && presetOrSchema !== null && !Array.isArray(presetOrSchema);
        const schema = isSchema ? presetOrSchema as IPropertySchema<T> : { preset: presetOrSchema as T };
        preset = preset !== undefined ? preset : schema.preset;
        const isArray = Array.isArray(preset);

        this.parent = null;
        this.key = null;

        this.value = null;
        this.changed = true;

        this.path = path;
        this.preset = preset;
        this.elements = isArray ? (preset as any).length : 1;
        this.type = typeof (isArray ? preset[0] : preset) as PropertyType;
        this.schema = schema;

        this.inLinks = [];
        this.outLinks = [];

        this.reset();
    }

    setValue(value: T)
    {
        this.value = value;
        this.changed = true;

        const outLinks = this.outLinks;
        for (let i = 0, n = outLinks.length; i < n; ++i) {
            outLinks[i].push();
        }

        this.parent.emitAny("value", this);
    }

    setChanged()
    {
        this.changed = true;

        const outLinks = this.outLinks;
        for (let i = 0, n = outLinks.length; i < n; ++i) {
            outLinks[i].push();
        }
    }

    linkTo(destination: Property, sourceIndex?: number, destinationIndex?: number)
    {
        destination.linkFrom(this, sourceIndex, destinationIndex);
    }

    linkFrom(source: Property, sourceIndex?: number, destinationIndex?: number)
    {
        if (!this.canLinkFrom(source, sourceIndex, destinationIndex)) {
            throw new Error("can't link");
        }

        const link = new PropertyLink(source, this, sourceIndex, destinationIndex);
        this.addInLink(link);
        source.addOutLink(link);
    }

    unlinkTo(destination: Property, sourceIndex?: number, destinationIndex?: number): boolean
    {
        return destination.unlinkFrom(this, sourceIndex, destinationIndex);
    }

    unlinkFrom(source: Property, sourceIndex?: number, destinationIndex?: number): boolean
    {
        const link = this.inLinks.find(link =>
            link.source === source
            && link.sourceIndex === sourceIndex
            && link.destinationIndex === destinationIndex
        );

        if (!link) {
            return false;
        }

        this.removeInLink(link);
        source.removeOutLink(link);

        return true;
    }

    unlink()
    {
        this.inLinks.forEach(link => link.source.removeOutLink(link));
        this.inLinks.length = 0;

        this.outLinks.forEach(link => link.destination.removeInLink(link));
        this.outLinks.length = 0;
    }

    addInLink(link: PropertyLink)
    {
        if(link.destination !== this) {
            throw new Error("input link's destination must equal this");
        }

        this.inLinks.push(link);
    }

    addOutLink(link: PropertyLink)
    {
        if(link.source !== this) {
            throw new Error("output link's source must equal this");
        }

        this.outLinks.push(link);

        // push value through added link
        link.push();
    }

    removeInLink(link: PropertyLink)
    {
        const index = this.inLinks.indexOf(link);
        if (index < 0) {
            throw new Error("input link not found");
        }

        this.inLinks.splice(index, 1);

        // if last link is removed and if object, reset to default (usually null) values
        if (this.inLinks.length === 0 && this.type === "object") {
            this.reset();
        }
    }

    removeOutLink(link: PropertyLink)
    {
        const index = this.outLinks.indexOf(link);
        if (index < 0) {
            throw new Error("output link not found");
        }

        this.outLinks.splice(index, 1);
    }

    canLinkTo(destination: Property, sourceIndex?: number, destinationIndex?: number): boolean
    {
        return destination.canLinkFrom(this, sourceIndex, destinationIndex);
    }

    canLinkFrom(source: Property, sourceIndex?: number, destinationIndex?: number): boolean
    {
        // can't link to an output property
        if (this.parent !== this.parent.linkable.ins) {
            return false;
        }

        const validSrcIndex = sourceIndex >= 0;
        const validDstIndex = destinationIndex >= 0;

        if (source.elements === 1 && validSrcIndex) {
            throw new Error("non-array source property; can't link to element");
        }
        if (this.elements === 1 && validDstIndex) {
            throw new Error("non-array destination property; can't link to element");
        }

        const srcIsArray = source.elements > 1 && !validSrcIndex;
        const dstIsArray = this.elements > 1 && !validDstIndex;

        if (srcIsArray !== dstIsArray) {
            return false;
        }
        if (srcIsArray && source.elements !== this.elements) {
            return false;
        }

        return canConvert(source.type, this.type);
    }

    reset()
    {
        if (this.hasInLinks()) {
            throw new Error("can't reset property with input links");
        }

        if (this.isMulti()) {
            let multiArray: T[] = this.value as any;

            if (!multiArray) {
                this.value = multiArray = [] as any;
            }
            else {
                multiArray.length = 1;
            }

            multiArray[0] = this.clonePreset();
        }
        else {
            this.value = this.clonePreset();
        }

        // set changed flag and push to output links
        this.setChanged();
    }

    setMultiChannelCount(count: number)
    {
        if (!this.isMulti()) {
            throw new Error("can't set multi channel count on non-multi property");
        }

        const multiArray: T[] = this.value as any;
        const currentCount = multiArray.length;
        multiArray.length = count;

        for (let i = currentCount; i < count; ++i) {
            multiArray[i] = this.clonePreset();
        }

        this.changed = true;
    }

    isMulti(): boolean
    {
        return !!this.schema.multi;
    }

    isDefault()
    {
        const value = this.schema.multi ? this.value[0] : this.value;
        const preset = this.preset;
        const valueLength = Array.isArray(value) ? value.length : -1;
        const presetLength = Array.isArray(preset) ? preset.length : -1;

        if (valueLength !== presetLength) {
            return false;
        }

        if (valueLength >= 0) {
            for (let i = 0; i < valueLength; ++i) {
                if (value[i] !== preset[i]) {
                    return false;
                }
            }
            return true;
        }

        return value === preset;
    }

    hasInLinks()
    {
        return this.inLinks.length > 0;
    }

    hasOutLinks()
    {
        return this.outLinks.length > 0;
    }

    inLinkCount()
    {
        return this.inLinks.length;
    }

    outLinkCount()
    {
        return this.outLinks.length;
    }

    toJSON()
    {
        const json: any = {
            key: this.key
        };

        if (!this.hasInLinks() && !this.isDefault()) {
            json.value = this.value;
        }

        if (this.hasOutLinks()) {
            json.links = this.outLinks.map(link => ({
                component: link.destination.parent.linkable.id,
                key: link.destination.key
            }));
        }
    }

    toString()
    {

    }

    protected clonePreset(): T
    {
        const preset = this.preset;

        if (Array.isArray(preset)) {
            return preset.slice() as any;
        }

        return preset;
    }
}
