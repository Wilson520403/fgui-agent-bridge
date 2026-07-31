declare namespace puer {
    function $ref(value?: any): any;
    function $unref(reference: any): any;
    function $set(reference: any, value: any): void;
    function $promise(value: any): Promise<any>;
    function $typeof(value: any): any;
}

declare module "puerts" {
    export = puer;
}
